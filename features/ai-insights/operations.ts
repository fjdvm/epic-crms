import type postgres from "postgres";

import { PAID_OR_FULFILLED } from "@/features/customer-profiles/rules";
import type { Period } from "@/features/dashboard/period";
import { notReplacement } from "@/lib/replacement-order";

export interface CourierFigures { courier: string; dispatched: number; failed: number }
export interface ProductReturns { product: string; sold: number; returned: number }
export interface ProductRating { product: string; ratings: number; average: number }
export interface StockCover { name: string; available: number; soldPerDay: number; daysLeft: number }

/** Money in centavos, times in hours. */
export interface OperationsInsights {
  fulfilment: { dispatched: number; medianDispatchHours: number | null; couriers: CourierFigures[] };
  returns: {
    requested: number;
    reasons: { label: string; count: number }[];
    products: ProductReturns[];
    restockedValue: number;
    writtenOffValue: number;
  };
  tickets: { opened: number; resolved: number; medianResolveHours: number | null; categories: { label: string; count: number }[]; averageRating: number | null };
  feedback: { ratings: number; average: number | null; negativeShare: number | null; lowestProducts: ProductRating[] };
}

export const MIN_RATINGS = 3;
export const MIN_RETURNED_UNITS = 2;
const hours = (value: number | string | null) => (value === null ? null : Math.round(Number(value) * 10) / 10);

export async function operationsInsightsIn(sql: postgres.Sql, period: Period): Promise<OperationsInsights> {
  // Read through to_jsonb, like the Fulfilment report, so this works before the storefront adds the column.
  const dispatchedAt = sql`(to_jsonb(o)->>'dispatched_at')::timestamptz`;
  const between = (column: postgres.PendingQuery<postgres.Row[]>) => sql`${column} >= ${period.start} and ${column} < ${period.end}`;
  // Delivery Orders placed in the period that went out with a courier; the status stands in while there is no dispatch time.
  const wentOut = sql`o.fulfillment_method = 'delivery' and ${notReplacement(sql, "o")} and ${between(sql`o.created_at`)}
    and (${dispatchedAt} is not null or o.status in ('dispatched', 'delivered', 'received'))`;

  const [dispatch] = await sql<{ dispatched: number; median: string | null }[]>`
    select count(*)::int as dispatched,
      percentile_cont(0.5) within group (order by extract(epoch from ${dispatchedAt} - o.paid_at) / 3600)
        filter (where o.paid_at is not null and ${dispatchedAt} >= o.paid_at) as median
    from public.orders o where ${wentOut}`;
  const couriers = await sql<CourierFigures[]>`
    select coalesce(nullif(trim(o.courier), ''), 'Not recorded') as courier, count(*)::int as dispatched,
      count(*) filter (where exists (select 1 from public.failed_deliveries f where f.order_id = o.id))::int as failed
    from public.orders o where ${wentOut}
    group by 1 order by dispatched desc, courier`;

  const reasons = await sql<{ label: string; count: number }[]>`
    select r.reason as label, count(*)::int as count from public.order_returns r
    where ${between(sql`r.requested_at`)} group by r.reason order by count desc, r.reason`;
  const products = await sql<{ product: string; sold: number; returned: number }[]>`
    with sold as (
      select l.product_name, sum(l.quantity)::int as units from public.order_lines l join public.orders o on o.id = l.order_id
      where o.status = any(${PAID_OR_FULFILLED}) and ${notReplacement(sql, "o")} and ${between(sql`o.created_at`)}
      group by l.product_name
    ), returned as (
      select i.product_name, sum(i.quantity)::int as units from public.order_return_items i join public.order_returns r on r.id = i.return_id
      where ${between(sql`r.requested_at`)} and r.status not in ('declined', 'cancelled')
      group by i.product_name
    )
    select returned.product_name as product, coalesce(sold.units, 0) as sold, returned.units as returned
    from returned left join sold on sold.product_name = returned.product_name
    order by returned.units desc, product limit 5`;
  const [inspected] = await sql<{ restocked: string; written_off: string }[]>`
    select coalesce(sum(i.quantity * i.price_in_centavos) filter (where i.condition = 'sellable'), 0)::bigint as restocked,
      coalesce(sum(i.quantity * i.price_in_centavos) filter (where i.condition = 'damaged'), 0)::bigint as written_off
    from public.order_return_items i where ${between(sql`i.inspected_at`)}`;

  const [tickets] = await sql<{ opened: number; resolved: number; median: string | null; rating: string | null }[]>`
    select count(*) filter (where ${between(sql`t.created_at`)})::int as opened,
      count(*) filter (where ${between(sql`t.resolved_at`)})::int as resolved,
      percentile_cont(0.5) within group (order by extract(epoch from t.resolved_at - t.created_at) / 3600)
        filter (where ${between(sql`t.resolved_at`)}) as median,
      avg(t.rating) filter (where ${between(sql`t.rated_at`)}) as rating
    from public.tickets t`;
  const categories = await sql<{ label: string; count: number }[]>`
    select t.category as label, count(*)::int as count from public.tickets t
    where ${between(sql`t.created_at`)} group by t.category order by count desc, t.category limit 5`;

  const [feedback] = await sql<{ ratings: number; average: string | null; negative: number; analysed: number }[]>`
    select count(*)::int as ratings, avg(f.rating) as average,
      count(*) filter (where f.sentiment = 'negative')::int as negative,
      count(*) filter (where f.sentiment is not null)::int as analysed
    from public.order_feedback f where ${between(sql`f.created_at`)}`;
  const lowest = await sql<{ product: string; ratings: number; average: string }[]>`
    select l.product_name as product, count(distinct f.order_id)::int as ratings, avg(f.rating) as average
    from public.order_feedback f join public.order_lines l on l.order_id = f.order_id
    where ${between(sql`f.created_at`)}
    group by l.product_name having count(distinct f.order_id) >= ${MIN_RATINGS}
    order by avg(f.rating), l.product_name limit 3`;

  return {
    fulfilment: { dispatched: dispatch.dispatched, medianDispatchHours: hours(dispatch.median), couriers: [...couriers] },
    returns: {
      requested: reasons.reduce((s, r) => s + r.count, 0),
      reasons: [...reasons],
      products: [...products],
      restockedValue: Number(inspected.restocked),
      writtenOffValue: Number(inspected.written_off),
    },
    tickets: {
      opened: tickets.opened, resolved: tickets.resolved, medianResolveHours: hours(tickets.median),
      categories: [...categories], averageRating: tickets.rating === null ? null : Math.round(Number(tickets.rating) * 10) / 10,
    },
    feedback: {
      ratings: feedback.ratings,
      average: feedback.average === null ? null : Math.round(Number(feedback.average) * 10) / 10,
      negativeShare: feedback.analysed === 0 ? null : feedback.negative / feedback.analysed,
      lowestProducts: lowest.map((r) => ({ product: r.product, ratings: r.ratings, average: Math.round(Number(r.average) * 10) / 10 })),
    },
  };
}

export const STOCK_SALES_DAYS = 14;
export const STOCK_WARN_DAYS = 5;

/**
 * Sizes that will run out within STOCK_WARN_DAYS at the last two weeks' selling speed. Read-only: the count is the
 * IMS's (crms.stock_count); CREOMS never changes it. Units sold are matched to IMS Sizes through public.sizes.
 */
export async function stockCoverAt(source: postgres.Sql, crms: postgres.Sql, now: Date): Promise<StockCover[]> {
  const since = new Date(now.getTime() - STOCK_SALES_DAYS * 24 * 60 * 60 * 1000);
  const sold = await source<{ ims_product_id: number; units: number }[]>`
    select s.ims_product_id, sum(l.quantity)::int as units
    from public.order_lines l
    join public.orders o on o.id = l.order_id
    join public.products p on p.name = l.product_name
    join public.sizes s on s.product_slug = p.slug and s.label = l.size_label
    where s.ims_product_id is not null and o.status <> 'cancelled' and ${notReplacement(source, "o")} and o.created_at >= ${since}
    group by s.ims_product_id`;
  if (sold.length === 0) return [];
  const stock = await crms<{ ims_product_id: number; name: string; variant: string | null; available: number | null }[]>`
    select ims_product_id, name, variant, available from crms.stock_count
    where active and available is not null and ims_product_id in ${crms(sold.map((s) => s.ims_product_id))}`;
  const units = new Map(sold.map((s) => [s.ims_product_id, s.units]));
  return stock
    .map((row) => {
      const soldPerDay = (units.get(row.ims_product_id) ?? 0) / STOCK_SALES_DAYS;
      const available = row.available ?? 0;
      return { name: row.variant ? `${row.name} (${row.variant})` : row.name, available, soldPerDay, daysLeft: soldPerDay > 0 ? available / soldPerDay : Infinity };
    })
    .filter((row) => row.daysLeft < STOCK_WARN_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name))
    .map((row) => ({ ...row, soldPerDay: Math.round(row.soldPerDay * 10) / 10, daysLeft: Math.floor(row.daysLeft) }));
}
