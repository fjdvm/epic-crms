import type postgres from "postgres";

import { PAID_OR_FULFILLED } from "@/features/customer-profiles/rules";
import { ORDERS_MODULE, PAYMENTS_MODULE } from "@/lib/portal/config";

import type { Period, Span } from "./period";

/** One widget's figure for the period and the one before it, or the fact that it could not be read. */
export type Widget = { ok: true; current: number; previous: number } | { ok: false };

/** A widget is present only when the Staff member holds the Module of its data. */
export interface DashboardFigures {
  /** Centavos. */
  sales?: Widget;
  orders?: Widget;
}

/** The Total spent rule across all Customers: paid and fulfilled Orders less Refunded Return amounts. */
async function salesIn(sql: postgres.Sql, span: Span): Promise<number> {
  const [row] = await sql<{ sales: string }[]>`
    select coalesce(sum(
      o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0)
        - coalesce((select sum(r.amount_in_centavos) from public.order_returns r
            where r.order_id = o.id and r.status = 'refunded'), 0)
    ), 0)::bigint as sales
    from public.orders o
    where o.status = any(${PAID_OR_FULFILLED}) and o.created_at >= ${span.start} and o.created_at < ${span.end}`;

  return Number(row.sales);
}

async function ordersIn(sql: postgres.Sql, span: Span): Promise<number> {
  const [row] = await sql<{ orders: number }[]>`
    select count(*)::int as orders from public.orders
    where status <> 'cancelled' and created_at >= ${span.start} and created_at < ${span.end}`;

  return row.orders;
}

/** Runs on its own so one widget failing leaves the others standing. */
async function widget(
  connect: () => postgres.Sql,
  period: Period,
  figure: (sql: postgres.Sql, span: Span) => Promise<number>,
): Promise<Widget> {
  try {
    const sql = connect();
    const [current, previous] = await Promise.all([figure(sql, period), figure(sql, period.previous)]);

    return { ok: true, current, previous };
  } catch {
    return { ok: false };
  }
}

export async function loadDashboardFigures(
  connect: () => postgres.Sql,
  { period, modules }: { period: Period; modules: readonly string[] },
): Promise<DashboardFigures> {
  const holds = (...wanted: string[]) => wanted.some((module) => modules.includes(module));

  const [sales, orders] = await Promise.all([
    holds(ORDERS_MODULE, PAYMENTS_MODULE) ? widget(connect, period, salesIn) : undefined,
    holds(ORDERS_MODULE) ? widget(connect, period, ordersIn) : undefined,
  ]);

  return {
    ...(sales && { sales }),
    ...(orders && { orders }),
  };
}
