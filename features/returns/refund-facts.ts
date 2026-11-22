import { database } from "@/lib/db";
import type { RefundOrder } from "./refund-rules";

/** The Order and earlier refunds the refund rules need (#611). Optional storefront columns are read defensively. */
export async function refundFacts(id: number, orderId: number): Promise<{ order: RefundOrder; reason: string; itemsInCentavos: number; requestedAt: Date; destinationMethod: string | null; prior: { itemsInCentavos: number; deliveryFeeInCentavos: number }[] } | null> {
  const sql = database();
  const [row] = await sql<{ reason: string; amount: number; gross: string; payment_method: string; fulfillment_method: string; subtotal: number;
    discount: string | null; fee: number | null; total: string | null; cod_amount: number | null; cod_at: Date | null; requested_at: Date; dest_method: string | null }[]>`
    select r.reason, r.amount_in_centavos as amount, r.requested_at, to_jsonb(r)->>'refund_method' as dest_method,
      (select coalesce(sum(quantity::bigint * price_in_centavos), 0)::text from public.order_return_items where return_id = r.id) as gross,
      o.payment_method, o.fulfillment_method, o.subtotal_in_centavos as subtotal, o.delivery_fee_in_centavos as fee,
      to_jsonb(o)->>'approved_discount_in_centavos' as discount, to_jsonb(o)->>'total_in_centavos' as total,
      o.cod_collected_amount_in_centavos as cod_amount, o.cod_collected_at as cod_at
    from public.order_returns r join public.orders o on o.id = r.order_id where r.id = ${id}`;
  if (!row) return null;
  const others = await sql<{ amount: number; fee: string | null }[]>`
    select amount_in_centavos as amount, to_jsonb(order_returns)->>'refund_delivery_fee_in_centavos' as fee
    from public.order_returns where order_id = ${orderId} and id <> ${id} and status = 'refunded'`;
  return {
    reason: row.reason, requestedAt: row.requested_at, destinationMethod: row.dest_method,
    // Items only. A Return recorded before this rule may carry the Delivery fee inside its amount, so it never exceeds its own lines.
    itemsInCentavos: Number(row.gross) > 0 ? Math.min(row.amount, Number(row.gross)) : row.amount,
    prior: others.map(other => ({ itemsInCentavos: other.amount, deliveryFeeInCentavos: Number(other.fee ?? 0) })),
    order: { paymentMethod: row.payment_method, fulfillmentMethod: row.fulfillment_method, subtotalInCentavos: row.subtotal,
      approvedDiscountInCentavos: row.discount === null ? null : Number(row.discount), deliveryFeeInCentavos: row.fee,
      totalInCentavos: row.total === null ? null : Number(row.total), codCollectedAmountInCentavos: row.cod_amount, codCollectedAt: row.cod_at },
  };
}
