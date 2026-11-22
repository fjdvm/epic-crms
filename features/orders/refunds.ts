import type postgres from "postgres";

import { customerNameSql } from "@/lib/deleted-customer";

import { PAYMENTS_WINDOW_DAYS } from "./payments";

/** One refund recorded on a Return, as the Payments page lists it. Read-only: refunds are settled on the Return. */
export interface RefundRow {
  returnId: number;
  number: string;
  orderId: number;
  customer: string;
  /** What was sent back, in centavos: the recorded refund, or the Return's items and Delivery fee for older refunds without details. */
  amountInCentavos: number;
  /** How the money was sent back; null on a refund recorded before the details existed. */
  method: string | null;
  reference: string | null;
  /** Who marked the Return Refunded, from the storefront's history. */
  settledBy: string | null;
  refundedAt: Date;
}

/** Refunds marked in the last 30 days, newest first. The storefront owns these rows; CREOMS only reads them. */
export async function loadRefunds(sql: postgres.Sql, now: Date = new Date()): Promise<RefundRow[]> {
  const since = new Date(now.getTime() - PAYMENTS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await sql<{
    id: number; order_id: number; customer: string; amount: string; method: string | null; reference: string | null;
    settled_by: string | null; refunded_at: Date;
  }[]>`select r.id, r.order_id, ${sql.unsafe(customerNameSql("c"))} as customer,
      coalesce((to_jsonb(r)->>'refund_amount_in_centavos')::bigint,
        r.amount_in_centavos + coalesce((to_jsonb(r)->>'refund_delivery_fee_in_centavos')::bigint, 0))::text as amount,
      to_jsonb(r)->>'refund_paid_method' as method, to_jsonb(r)->>'refund_reference' as reference,
      (select h.actor_name from public.order_return_history h where h.return_id = r.id and h.status = 'refunded'
        order by h.occurred_at desc limit 1) as settled_by,
      r.refunded_at
    from public.order_returns r join public.orders o on o.id = r.order_id join public.customers c on c.id = o.customer_id
    where r.status = 'refunded' and r.refunded_at >= ${since}
    order by r.refunded_at desc, r.id desc`;

  return rows.map((row) => ({
    returnId: row.id, number: `RMA-${row.id}`, orderId: row.order_id, customer: row.customer,
    amountInCentavos: Number(row.amount), method: row.method, reference: row.reference, settledBy: row.settled_by, refundedAt: row.refunded_at,
  }));
}
