import type postgres from "postgres";

import { formatPesos } from "@/features/customer-profiles/format";

import { refundMethodLabel, returnLabel } from "./refund-record";
import type { ReturnStatus } from "./returns";

/** The ₱0 Replacement Order a Return sent, with where it is now. */
export interface ReplacementRef { orderId: number; status: string }

/** Statuses at which the Customer has the replacement in hand. */
const REPLACEMENT_DONE = ["delivered", "received"];

/**
 * How a Return ended, worked out from the storefront's records; CREOMS stores nothing. A refund is Completed once
 * Refunded. A replacement is Completed only once its Replacement Order is delivered; until then it is in progress.
 * A Replaced Return from before Replacement Orders existed has none and counts as Completed.
 */
export function returnOutcome(status: ReturnStatus, replacement?: ReplacementRef | null): { label: string; completed: boolean } | null {
  if (status === "refunded") return { label: "Completed · Refunded", completed: true };
  if (status !== "replaced") return null;
  if (!replacement || REPLACEMENT_DONE.includes(replacement.status)) return { label: "Completed · Replaced", completed: true };
  if (replacement.status === "cancelled") return { label: "Replacement cancelled", completed: false };

  return { label: "Replacement in progress", completed: false };
}

/** The on-screen label of a Return: its outcome once it has one, otherwise its status label. */
export function returnDisplayLabel(status: ReturnStatus, goodsRequired?: boolean | null, replacement?: ReplacementRef | null): string {
  return returnOutcome(status, replacement)?.label ?? returnLabel(status, goodsRequired);
}

/** SQL for a Return's Replacement Order id and status, read through `to_jsonb` so it works before the storefront adds the column. */
export const REPLACEMENT_COLUMNS = (alias: string) => `
  (select ro.id from public.orders ro where to_jsonb(ro)->>'replacement_for_return_id' = ${alias}.id::text order by ro.id limit 1) as replacement_order_id,
  (select ro.status from public.orders ro where to_jsonb(ro)->>'replacement_for_return_id' = ${alias}.id::text order by ro.id limit 1) as replacement_status`;

export const replacementRef = (row: { replacement_order_id: number | null; replacement_status: string | null }): ReplacementRef | null =>
  row.replacement_order_id === null || row.replacement_status === null ? null : { orderId: row.replacement_order_id, status: row.replacement_status };

/** One line on the Order detail saying how one of its Returns stands, for anyone who can open the Order. */
export interface OrderReturnOutcome { id: number; number: string; label: string; detail: string | null; replacementOrderId: number | null }

/** What the Order detail shows about its Returns and, for a Replacement Order, what it replaces. Null when it could not be read. */
export interface OrderReturnSummary { returns: OrderReturnOutcome[]; replacementFor: { orderId: number; returnId: number } | null }

export async function loadOrderReturnSummary(connect: () => postgres.Sql, orderId: number): Promise<OrderReturnSummary | null> {
  try {
    const sql = connect();
    const rows = await sql<{
      id: number; status: ReturnStatus; goods_required: boolean | null; decline_reason: string | null;
      paid_amount: string | null; paid_method: string | null; refunded_at: Date | null;
      replacement_order_id: number | null; replacement_status: string | null;
    }[]>`select r.id, r.status, r.goods_required, r.decline_reason, r.refunded_at,
        to_jsonb(r)->>'refund_amount_in_centavos' as paid_amount, to_jsonb(r)->>'refund_paid_method' as paid_method,
        ${sql.unsafe(REPLACEMENT_COLUMNS("r"))}
      from public.order_returns r where r.order_id = ${orderId} and r.status <> 'cancelled' order by r.id`;
    const [self] = await sql<{ for_order: string | null; for_return: string | null }[]>`
      select to_jsonb(o)->>'replacement_for_order_id' as for_order, to_jsonb(o)->>'replacement_for_return_id' as for_return
      from public.orders o where o.id = ${orderId}`;
    return {
      returns: rows.map((row) => {
        const replacement = replacementRef(row);
        const detail = row.status === "refunded" && row.paid_amount !== null
          ? `${formatPesos(Number(row.paid_amount))}${row.paid_method ? ` by ${refundMethodLabel(row.paid_method)}` : ""}`
          : row.status === "declined" ? row.decline_reason
            : replacement ? `Replacement Order #${replacement.orderId}` : null;
        return { id: row.id, number: `RMA-${row.id}`, label: returnDisplayLabel(row.status, row.goods_required, replacement), detail, replacementOrderId: replacement?.orderId ?? null };
      }),
      replacementFor: self?.for_order && self.for_return ? { orderId: Number(self.for_order), returnId: Number(self.for_return) } : null,
    };
  } catch (error) {
    console.error(`The Returns of Order #${orderId} could not be read`, error);
    return null;
  }
}
