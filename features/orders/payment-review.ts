import type postgres from "postgres";

import { MANAGER_AFTER_REJECTIONS } from "./payment-methods";

const HOUR = 3_600_000;

/** A Manager payment review: an Order still awaiting payment after its third rejected proof. */
export interface PaymentReview {
  /** The third rejection; the Admin's target counts from here. */
  startedAt: Date;
  /** Null when the target is switched off. */
  deadline: Date | null;
  /** Past the target and still unsettled. Flagged only; nothing is cancelled. */
  overdue: boolean;
  owner: { id: string; name: string; claimedAt: Date } | null;
}

/** Whether an Order is in a Manager payment review, from the facts the storefront holds. */
export const inReview = (o: { status: string; rejections: number; rejectedAt: Date | null }): boolean =>
  o.status === "awaiting payment" && o.rejections >= MANAGER_AFTER_REJECTIONS && o.rejectedAt !== null;

/** The review's deadline and Overdue flag. A null target (rule off) never flags. */
export function reviewTiming(startedAt: Date, targetHours: number | null, now: Date): { deadline: Date | null; overdue: boolean } {
  if (targetHours === null) return { deadline: null, overdue: false };
  const deadline = new Date(startedAt.getTime() + targetHours * HOUR);
  return { deadline, overdue: now.getTime() >= deadline.getTime() };
}

/** The review on one Order, or null when it is not in review. Reads the storefront and CREOMS's claim. */
export async function loadPaymentReview(
  storefront: postgres.Sql, crms: postgres.Sql, orderId: number, targetHours: number | null, now: Date = new Date(),
): Promise<PaymentReview | null> {
  const [order] = await storefront<{ status: string; rejections: number; rejected_at: Date | null }[]>`
    select status, payment_proof_rejections as rejections, payment_proof_rejected_at as rejected_at from public.orders where id = ${orderId}`;
  if (!order || !inReview({ status: order.status, rejections: order.rejections, rejectedAt: order.rejected_at })) return null;
  const [claim] = await crms<{ claimed_by_id: string; claimed_by_name: string; claimed_at: Date }[]>`
    select claimed_by_id, claimed_by_name, claimed_at from crms.payment_review_claims where order_id = ${orderId}`;
  return {
    startedAt: order.rejected_at!, ...reviewTiming(order.rejected_at!, targetHours, now),
    owner: claim ? { id: claim.claimed_by_id, name: claim.claimed_by_name, claimedAt: claim.claimed_at } : null,
  };
}

/** Claims an unclaimed review. The holder's name when someone already has it, or null when this call took it. */
export async function claimReview(crms: postgres.Sql, orderId: number, by: { id: string; name: string }): Promise<{ holder: string } | null> {
  const [row] = await crms<{ claimed_by_name: string; claimed_by_id: string }[]>`
    insert into crms.payment_review_claims (order_id, claimed_by_id, claimed_by_name) values (${orderId}, ${by.id}, ${by.name})
    on conflict (order_id) do nothing returning claimed_by_id, claimed_by_name`;
  if (row) return null;
  const [holder] = await crms<{ claimed_by_name: string }[]>`select claimed_by_name from crms.payment_review_claims where order_id = ${orderId}`;
  return { holder: holder?.claimed_by_name ?? "another Manager" };
}

/** Hands the review to another Manager. Refused (false) when the owner changed since the caller looked. */
export async function reassignReview(
  crms: postgres.Sql, orderId: number, from: string | null, to: { id: string; name: string },
): Promise<boolean> {
  if (from === null) {
    const [row] = await crms`insert into crms.payment_review_claims (order_id, claimed_by_id, claimed_by_name) values (${orderId}, ${to.id}, ${to.name})
      on conflict (order_id) do nothing returning order_id`;
    return Boolean(row);
  }
  const rows = await crms`update crms.payment_review_claims set claimed_by_id = ${to.id}, claimed_by_name = ${to.name}, claimed_at = now()
    where order_id = ${orderId} and claimed_by_id = ${from} returning order_id`;
  return rows.length === 1;
}
