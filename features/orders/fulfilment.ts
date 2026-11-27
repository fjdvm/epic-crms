import type postgres from "postgres";
import { customerNameSql } from "@/lib/deleted-customer";

import { paymentStatusOf } from "@/features/customer-profiles/rules";
import type { OrderRow } from "./orders";

export interface FulfilmentOrder extends OrderRow {
  fulfillmentMethod: string;
  paymentMethod: string;
  /** When the Order was delivered (`delivered_at`). Kept after the Customer marks it received. */
  deliveredAt: Date | null;
  /** True when a failed delivery is still open: not rebooked. */
  failedOpen: boolean;
  /** Null until the storefront records a pack, and for legacy Orders. */
  packedBy: { name: string } | null;
}

export const TABS = [
  { key: "all-active", label: "All active" },
  { key: "to-pack", label: "To pack" },
  { key: "preparing", label: "Preparing" },
  { key: "out-for-delivery", label: "Out for delivery" },
  { key: "failed", label: "Failed" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
] as const;
export type FulfilmentTab = (typeof TABS)[number]["key"];

export type FulfilmentBoard = { orders: FulfilmentOrder[] };
export type FulfilmentBoardResult = { ok: true; board: FulfilmentBoard } | { ok: false };

const COMPLETED = ["delivered", "received"];

/** The phase an Order is in. Tabs are views, never statuses. */
export function tabOf(order: FulfilmentOrder): Exclude<FulfilmentTab, "all-active" | "all"> | null {
  if (readyToPrepare(order)) return "to-pack";
  if (order.status === "preparing") return "preparing";
  if (order.status === "dispatched") return order.failedOpen ? "failed" : "out-for-delivery";
  if (COMPLETED.includes(order.status)) return "completed";
  return null;
}

/** Orders on a tab: To pack and the like oldest first, Completed newest first by original completion time. */
export function ordersOnTab(board: FulfilmentBoard, tab: FulfilmentTab): FulfilmentOrder[] {
  const completedFirst = (a: FulfilmentOrder, b: FulfilmentOrder) => (b.deliveredAt?.getTime() ?? 0) - (a.deliveredAt?.getTime() ?? 0);
  const openOrders = board.orders.filter(o => { const t = tabOf(o); return t !== null && t !== "completed"; });
  const done = board.orders.filter(o => tabOf(o) === "completed").sort(completedFirst);
  if (tab === "all-active") return openOrders;
  if (tab === "all") return [...openOrders, ...done];
  if (tab === "completed") return done;
  // Out for delivery holds every dispatched Order; Failed lists the ones with an open failed delivery on their own.
  if (tab === "out-for-delivery") return openOrders.filter(o => o.status === "dispatched");
  return openOrders.filter(o => tabOf(o) === tab);
}

/** The storefront permits preparation once Cash on Delivery is confirmed, or payment is accepted. */
export function readyToPrepare(order: { status: string; paymentMethod: string }): boolean {
  return order.status === "paid" || (order.status === "confirmed" && order.paymentMethod === "cash-on-delivery");
}

/** Open Orders oldest first; completed Orders within a rolling seven days of their original completion time. */
export async function loadFulfilmentBoard(
  connect: () => postgres.Sql,
  options: { now?: Date } = {},
): Promise<FulfilmentBoardResult> {
  const now = options.now ?? new Date();
  const completedSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  try {
    const sql = connect();
    const rows = await sql<{
      id: number; status: string; fulfillment_method: string; payment_method: string;
      completed_at: Date | null; packed_by_name: string | null; failed_open: boolean; created_at: Date; customer_id: string; full_name: string; total: number;
    }[]>`
      select o.id, o.status, o.fulfillment_method, o.payment_method,
        o.delivered_at as completed_at,
        to_jsonb(o)->>'packed_by_name' as packed_by_name,
        exists (select 1 from public.failed_deliveries f where f.order_id = o.id and f.rebooked_at is null) as failed_open,
        o.created_at, o.customer_id, ${sql.unsafe(customerNameSql('c'))} as full_name,
        o.subtotal_in_centavos - coalesce((to_jsonb(o)->>'discount_in_centavos')::int, 0) + coalesce(o.delivery_fee_in_centavos, 0) as total
      from public.orders o join public.customers c on c.id = o.customer_id
      where o.status in ('confirmed', 'paid', 'preparing', 'dispatched')
        or (o.status in ('delivered', 'received')
          and o.delivered_at >= ${completedSince}
          and o.delivered_at <= ${now})
      order by o.created_at, o.id`;
    const lines = rows.length === 0 ? [] : await sql<{ order_id: number; product_name: string; quantity: number }[]>`
      select order_id, product_name, quantity from public.order_lines
      where order_id in ${sql(rows.map(row => row.id))} order by id`;
    const orders: FulfilmentOrder[] = rows.map(row => ({
      id: row.id, status: row.status, fulfillmentMethod: row.fulfillment_method,
      paymentMethod: row.payment_method, deliveredAt: row.completed_at, failedOpen: row.failed_open,
      packedBy: row.packed_by_name ? { name: row.packed_by_name } : null, createdAt: row.created_at,
      customerId: row.customer_id, customerName: row.full_name, total: row.total,
      paymentLabel: paymentStatusOf(row.status),
      lines: lines.filter(line => line.order_id === row.id).map(line => ({ product: line.product_name, quantity: line.quantity })),
    }));
    return { ok: true, board: { orders } };
  } catch {
    return { ok: false };
  }
}
