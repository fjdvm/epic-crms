import { DEFAULT_AUTOMATIC_CHECKS, type AutomaticChecks } from "@/features/settings/automatic-checks";
import { customerNameSql } from "@/lib/deleted-customer";
import { paymentProofChecksForOrders, type PaymentProofChecks } from "./payment-proof-checks";
import type postgres from "postgres";

import { proofAccount, type ProofAccount, type ProofAccountRow } from "./proof-account";
import { paymentScreenshotSource } from "./payment-screenshot";
import { isPrepaid, PREPAID_METHODS, type PaymentMethod } from "./payment-methods";
import { inReview, reviewTiming } from "./payment-review";

export type { PaymentMethod };

export interface PaymentQueueOrder {
  id: number;
  createdAt: Date;
  customer: { id: string; name: string };
  /** Centavos, including the Delivery fee. */
  total: number;
  paymentProof: { reference: string | null; screenshot: string | null; submittedAt: Date };
}

export type PaymentQueueResult = { ok: true; orders: PaymentQueueOrder[] } | { ok: false; reason: string };

/** Oldest submitted proof first; a screenshot is optional, and ties use the Order number. */
export async function paymentQueue(sql: postgres.Sql): Promise<PaymentQueueOrder[]> {
  const rows = await sql<{
    id: number; created_at: Date; customer_id: string; full_name: string; total: number;
    gcash_reference_number: string | null; payment_proof_screenshot_pathname: string | null; payment_proof_file_id: string | null;
    payment_proof_submitted_at: Date;
  }[]>`
    select o.id, o.created_at, o.customer_id, ${sql.unsafe(customerNameSql('c'))} as full_name,
      o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0) as total,
      o.gcash_reference_number, o.payment_proof_screenshot_pathname, o.payment_proof_file_id, o.payment_proof_submitted_at
    from public.orders o join public.customers c on c.id = o.customer_id
    where o.payment_method in ${sql(PREPAID_METHODS)} and o.status = 'awaiting payment'
      and o.payment_proof_submitted_at is not null and o.payment_proof_rejected_at is null
    order by o.payment_proof_submitted_at asc, o.id asc`;

  return rows.map(o => ({
    id: o.id, createdAt: o.created_at,
    customer: { id: o.customer_id, name: o.full_name }, total: o.total,
    paymentProof: {
      reference: o.gcash_reference_number, screenshot: paymentScreenshotSource(o.id, o.payment_proof_file_id, o.payment_proof_screenshot_pathname),
      submittedAt: o.payment_proof_submitted_at,
    },
  }));
}

/** One prepaid Order with proof, or one Cash on Delivery Order: everything the Payments page counts. */
export interface PaymentRow {
  id: number;
  customer: { id: string; name: string };
  method: PaymentMethod;
  status: string;
  /** Centavos, including the Delivery fee. */
  total: number;
  /** Null for Cash on Delivery, which has no proof. */
  proof: { reference: string | null; screenshot: string | null; submittedAt: Date; account?: ProofAccount | null } | null;
  /** When the latest proof was rejected; null while it waits for a check or after a new one arrives. */
  proofRejectedAt: Date | null;
  /** Proofs rejected so far; at 3 only a Manager can approve. */
  rejections: number;
  proofChecks?: PaymentProofChecks;
  /** Set when the Order is in Manager payment review (third rejected proof, still awaiting payment). */
  review?: PaymentRowReview;
}

/** What the Manager review tab shows about one Order in review. */
export interface PaymentRowReview {
  startedAt: Date;
  deadline: Date | null;
  /** Past the Admin's target and still unsettled. Flagged only; nothing is cancelled. */
  overdue: boolean;
  /** Null until a Manager takes it with Claim review. */
  owner: { id: string; name: string } | null;
}

export type PaymentsResult = { ok: true; rows: PaymentRow[]; now: Date } | { ok: false; reason: string };

/** Days of settled Orders (paid, collected, rejected) the page keeps counting. */
export const PAYMENTS_WINDOW_DAYS = 30;

const ACTIVE = ["awaiting payment", "confirmed", "preparing", "dispatched"];

/** Open work at any age, plus everything created in the window. */
export async function paymentRows(sql: postgres.Sql, now: Date = new Date(), settings: AutomaticChecks = DEFAULT_AUTOMATIC_CHECKS, crms?: postgres.Sql): Promise<PaymentRow[]> {
  const since = new Date(now.getTime() - PAYMENTS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await sql<{
    id: number; customer_id: string; full_name: string; payment_method: PaymentMethod; status: string; total: number;
    gcash_reference_number: string | null; payment_proof_screenshot_pathname: string | null; payment_proof_file_id: string | null;
    payment_proof_submitted_at: Date | null; payment_proof_rejected_at: Date | null; payment_proof_rejections: number;
  }[]>`
    select o.id, o.customer_id, ${sql.unsafe(customerNameSql('c'))} as full_name, o.payment_method, o.status,
      o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0) as total,
      o.gcash_reference_number, o.payment_proof_screenshot_pathname, o.payment_proof_file_id, o.payment_proof_submitted_at,
      o.payment_proof_rejected_at, o.payment_proof_rejections
    from public.orders o join public.customers c on c.id = o.customer_id
    where ((o.payment_method in ${sql(PREPAID_METHODS)} and o.payment_proof_submitted_at is not null)
        or o.payment_method = 'cash-on-delivery')
      and (o.status in ${sql(ACTIVE)} or o.created_at >= ${since})
    order by o.id`;

  const byProof = await paymentProofChecksForOrders(sql, rows.filter(o => o.payment_proof_submitted_at !== null).map(o => o.id), settings);
  // The query orders proofs oldest first; retain only the most recent for each Order below.
  const latestProofs = rows.length ? await sql<({ id: number; order_id: number } & ProofAccountRow)[]>`
    select distinct on (order_id) id, order_id, account_id, account_method, account_bank_name, account_label, account_name, account_number from public.order_payment_proofs
    where order_id in ${sql(rows.map(o => o.id))} order by order_id, submitted_at desc, id desc` : [];
  const byOrder = new Map(latestProofs.map(p => [p.order_id, byProof.get(p.id)]));
  const accounts = new Map(latestProofs.map(p => [p.order_id, proofAccount(p)]));
  const reviewIds = rows.filter(o => inReview({ status: o.status, rejections: o.payment_proof_rejections, rejectedAt: o.payment_proof_rejected_at })).map(o => o.id);
  const claims = new Map<number, { id: string; name: string }>();
  if (crms && reviewIds.length) {
    const found = await crms<{ order_id: number; claimed_by_id: string; claimed_by_name: string }[]>`
      select order_id, claimed_by_id, claimed_by_name from crms.payment_review_claims where order_id in ${crms(reviewIds)}`;
    for (const c of found) claims.set(c.order_id, { id: c.claimed_by_id, name: c.claimed_by_name });
  }
  const target = settings.dashboard.paymentReviews.enabled ? settings.dashboard.paymentReviews.hours : null;
  return rows.map(o => ({
    review: reviewIds.includes(o.id)
      ? { startedAt: o.payment_proof_rejected_at!, ...reviewTiming(o.payment_proof_rejected_at!, target, now), owner: claims.get(o.id) ?? null }
      : undefined,
    proofChecks: byOrder.get(o.id),
    id: o.id, customer: { id: o.customer_id, name: o.full_name }, method: o.payment_method, status: o.status,
    total: o.total,
    proof: o.payment_proof_submitted_at
      ? { reference: o.gcash_reference_number, screenshot: paymentScreenshotSource(o.id, o.payment_proof_file_id, o.payment_proof_screenshot_pathname), submittedAt: o.payment_proof_submitted_at, account: accounts.get(o.id) ?? null }
      : null,
    proofRejectedAt: o.payment_proof_rejected_at, rejections: o.payment_proof_rejections,
  }));
}

export type PaymentTab = "verify" | "review" | "cod" | "paid" | "rejected";

const PREPAID_PAID = ["paid", "preparing", "dispatched", "delivered", "received"];
const COD_OPEN = ["confirmed", "preparing", "dispatched"];

/** A proof waiting for a check: submitted, not rejected. */
export const awaitingCheck = (r: PaymentRow): boolean =>
  isPrepaid(r.method) && r.status === "awaiting payment" && r.proof !== null && r.proofRejectedAt === null;
/** Cash on Delivery the courier has not yet handed back as delivered. */
export const codToCollect = (r: PaymentRow): boolean => r.method === "cash-on-delivery" && COD_OPEN.includes(r.status);
/** Money in: a prepaid proof accepted, or Cash on Delivery collected on delivery. */
export const settled = (r: PaymentRow): boolean =>
  isPrepaid(r.method) ? PREPAID_PAID.includes(r.status) : ["delivered", "received"].includes(r.status);
/** A prepaid Order whose proof was rejected and is waiting for a new one, or that was cancelled after the Customer sent proof. */
export const rejected = (r: PaymentRow): boolean =>
  isPrepaid(r.method) && r.proof !== null && !r.review && (r.status === "cancelled" || r.status === "awaiting payment" && r.proofRejectedAt !== null);

/** In Manager payment review: the third rejected proof, still awaiting payment. */
export const inManagerReview = (r: PaymentRow): boolean => r.review !== undefined && r.status === "awaiting payment";

/** Overdue reviews first, then the longest waiting; ties use the Order number. */
export const byReviewUrgency = (a: PaymentRow, b: PaymentRow): number =>
  Number(b.review!.overdue) - Number(a.review!.overdue) || a.review!.startedAt.getTime() - b.review!.startedAt.getTime() || a.id - b.id;

/** The page's tabs and stat cards, all derived from the rows so an optimistic change moves both. */
export function summarize(rows: PaymentRow[], now: Date) {
  const verify = rows.filter(awaitingCheck).sort((a, b) => a.proof!.submittedAt.getTime() - b.proof!.submittedAt.getTime() || a.id - b.id);
  const tabs: Record<PaymentTab, PaymentRow[]> = {
    verify,
    review: rows.filter(inManagerReview).sort(byReviewUrgency),
    cod: rows.filter(codToCollect),
    paid: rows.filter(settled).sort((a, b) => b.id - a.id),
    rejected: rows.filter(rejected).sort((a, b) => b.id - a.id),
  };
  const sum = (list: PaymentRow[]) => list.reduce((total, r) => total + r.total, 0);
  const collected = rows.filter((r) => r.method === "cash-on-delivery" && ["delivered", "received"].includes(r.status));
  const gcashPaid = tabs.paid.filter((r) => r.method === "gcash");

  return {
    tabs,
    oldestProof: verify[0]?.proof!.submittedAt ?? null,
    paid: { count: tabs.paid.length, centavos: sum(tabs.paid) },
    gcashPaid: { count: gcashPaid.length, centavos: sum(gcashPaid) },
    collected: { count: collected.length, centavos: sum(collected) },
    toCollect: { count: tabs.cod.length, centavos: sum(tabs.cod) },
    rejected: { count: tabs.rejected.length, centavos: sum(tabs.rejected) },
    now,
  };
}
