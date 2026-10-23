import type postgres from "postgres";

import { paymentStatusOf } from "@/features/customer-profiles/rules";
import type { OrderRow } from "./orders";

export interface FulfilmentOrder extends OrderRow {
  fulfillmentMethod: string;
  paymentMethod: string;
  deliveredAt: Date | null;
}

export type FulfilmentBoard = Record<"ready" | "preparing" | "dispatched" | "delivered", FulfilmentOrder[]>;
export type FulfilmentBoardResult = { ok: true; board: FulfilmentBoard } | { ok: false };

/** The storefront permits preparation once Cash on Delivery is confirmed, or payment is accepted. */
export function readyToPrepare(order: { status: string; paymentMethod: string }): boolean {
  return order.status === "paid" || (order.status === "confirmed" && order.paymentMethod === "cash-on-delivery");
}

/** Active Orders oldest first; delivered Orders newest first within a rolling seven-day window. */
export async function loadFulfilmentBoard(
  connect: () => postgres.Sql,
  options: { now?: Date } = {},
): Promise<FulfilmentBoardResult> {
  const now = options.now ?? new Date();
  const deliveredSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  try {
    const sql = connect();
    const rows = await sql<{
      id: number; status: string; fulfillment_method: string; payment_method: string;
      delivered_at: Date | null; created_at: Date; customer_id: string; full_name: string; total: number;
    }[]>`
      select o.id, o.status, o.fulfillment_method, o.payment_method, o.delivered_at,
        o.created_at, o.customer_id, c.full_name,
        o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0) as total
      from public.orders o join public.customers c on c.id = o.customer_id
      where o.status in ('confirmed', 'paid', 'preparing', 'dispatched')
        or (o.status in ('delivered', 'received') and o.delivered_at >= ${deliveredSince} and o.delivered_at <= ${now})
      order by case when o.status in ('delivered', 'received') then o.delivered_at end desc, o.created_at, o.id`;
    const lines = rows.length === 0 ? [] : await sql<{ order_id: number; product_name: string; quantity: number }[]>`
      select order_id, product_name, quantity from public.order_lines
      where order_id in ${sql(rows.map(row => row.id))} order by id`;
    const orders: FulfilmentOrder[] = rows.map(row => ({
      id: row.id, status: row.status, fulfillmentMethod: row.fulfillment_method,
      paymentMethod: row.payment_method, deliveredAt: row.delivered_at, createdAt: row.created_at,
      customerId: row.customer_id, customerName: row.full_name, total: row.total,
      paymentLabel: paymentStatusOf(row.status),
      lines: lines.filter(line => line.order_id === row.id).map(line => ({ product: line.product_name, quantity: line.quantity })),
    }));
    return { ok: true, board: {
      ready: orders.filter(readyToPrepare),
      preparing: orders.filter(order => order.status === "preparing"),
      dispatched: orders.filter(order => order.status === "dispatched"),
      delivered: orders.filter(order => ["delivered", "received"].includes(order.status)),
    } };
  } catch {
    return { ok: false };
  }
}
