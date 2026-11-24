import type postgres from "postgres";

import type { Period } from "@/features/dashboard/period";
import { notReplacement } from "@/lib/replacement-order";

export interface FunnelStep { key: "placed" | "paid" | "handedOver" | "delivered"; count: number; medianHours: number | null }
export interface Ranked { label: string; count: number }
export interface ProductPair { a: string; b: string; orders: number; ordersOfLessPopular: number }

export interface OrderInsights {
  /** Orders placed in the period and how far they got. Median hours are from the step before. */
  funnel: FunnelStep[];
  cancelled: number;
  /** Orders placed, by Philippine weekday (0 = Sunday) and hour. */
  peak: number[][];
  cancelReasons: Ranked[];
  failedReasons: Ranked[];
  pairs: ProductPair[];
}

const hours = (value: number | string | null) => (value === null ? null : Math.round(Number(value) * 10) / 10);

/** Everything about Orders placed in the period, excluding Replacement Orders. */
export async function orderInsightsIn(sql: postgres.Sql, period: Period): Promise<OrderInsights> {
  // Read through to_jsonb, like the Fulfilment report, so this works before the storefront adds the column.
  const DISPATCHED_AT = sql`(to_jsonb(o)->>'dispatched_at')::timestamptz`;
  const inPeriod = sql`o.created_at >= ${period.start} and o.created_at < ${period.end} and ${notReplacement(sql, "o")}`;

  const [funnel] = await sql<{
    placed: number; paid: number; handed: number; delivered: number; cancelled: number;
    to_paid: string | null; to_handed: string | null; to_delivered: string | null;
  }[]>`
    with base as (
      select o.status, o.created_at, o.paid_at,
        coalesce(${DISPATCHED_AT}, o.collected_at) as handed_at,
        coalesce(o.delivered_at, o.collected_at) as delivered_at,
        ${DISPATCHED_AT} is not null or o.collected_at is not null or o.status in ('dispatched', 'delivered', 'received') as handed,
        o.delivered_at is not null or o.collected_at is not null or o.status in ('delivered', 'received') as delivered
      from public.orders o where ${inPeriod}
    ), o as (
      select *, paid_at is not null or (status not in ('placed', 'confirmed', 'cancelled')) or handed as paid from base
    )
    select count(*)::int as placed,
      count(*) filter (where paid)::int as paid,
      count(*) filter (where handed)::int as handed,
      count(*) filter (where delivered)::int as delivered,
      count(*) filter (where status = 'cancelled')::int as cancelled,
      percentile_cont(0.5) within group (order by extract(epoch from paid_at - created_at) / 3600) filter (where paid_at is not null) as to_paid,
      percentile_cont(0.5) within group (order by extract(epoch from handed_at - coalesce(paid_at, created_at)) / 3600) filter (where handed_at is not null) as to_handed,
      percentile_cont(0.5) within group (order by extract(epoch from delivered_at - handed_at) / 3600) filter (where delivered_at is not null and handed_at is not null and delivered_at > handed_at) as to_delivered
    from o`;

  const peakRows = await sql<{ dow: number; hour: number; count: number }[]>`
    select extract(dow from o.created_at at time zone 'Asia/Manila')::int as dow,
      extract(hour from o.created_at at time zone 'Asia/Manila')::int as hour, count(*)::int as count
    from public.orders o where ${inPeriod} group by 1, 2`;
  const peak = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const row of peakRows) peak[row.dow][row.hour] = row.count;

  const cancelReasons = await sql<Ranked[]>`
    select c.reason as label, count(*)::int as count
    from public.order_cancellations c join public.orders o on o.id = c.order_id
    where ${inPeriod} group by c.reason order by count desc, c.reason limit 5`;

  const failedReasons = await sql<Ranked[]>`
    select f.reason as label, count(*)::int as count
    from public.failed_deliveries f join public.orders o on o.id = f.order_id
    where f.created_at >= ${period.start} and f.created_at < ${period.end}
    group by f.reason order by count desc, f.reason limit 5`;

  const pairs = await sql<{ a: string; b: string; orders: number; less: number }[]>`
    with lines as (
      select distinct l.order_id, l.product_name from public.order_lines l
      join public.orders o on o.id = l.order_id
      where ${inPeriod} and o.status <> 'cancelled'
    ), single as (select product_name, count(*)::int as orders from lines group by product_name)
    select x.product_name as a, y.product_name as b, count(*)::int as orders,
      least(sa.orders, sb.orders)::int as less
    from lines x join lines y on y.order_id = x.order_id and y.product_name > x.product_name
    join single sa on sa.product_name = x.product_name join single sb on sb.product_name = y.product_name
    group by x.product_name, y.product_name, sa.orders, sb.orders
    order by orders desc, a, b limit 5`;

  return {
    funnel: [
      { key: "placed", count: funnel.placed, medianHours: null },
      { key: "paid", count: funnel.paid, medianHours: hours(funnel.to_paid) },
      { key: "handedOver", count: funnel.handed, medianHours: hours(funnel.to_handed) },
      { key: "delivered", count: funnel.delivered, medianHours: hours(funnel.to_delivered) },
    ],
    cancelled: funnel.cancelled,
    peak,
    cancelReasons: [...cancelReasons],
    failedReasons: [...failedReasons],
    pairs: pairs.map((p) => ({ a: p.a, b: p.b, orders: p.orders, ordersOfLessPopular: p.less })),
  };
}
