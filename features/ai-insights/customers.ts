import type postgres from "postgres";

import { PAID_OR_FULFILLED, stageOf, type Stage } from "@/features/customer-profiles/rules";
import type { Period } from "@/features/dashboard/period";
import { notReplacement } from "@/lib/replacement-order";

export interface ValueBucket { label: string; customers: number }
export interface TopCustomer { id: string; name: string; orders: number; spent: number; lastOrder: Date }

/** Lifetime figures use Orders counted in Sales; money in centavos. */
export interface CustomerInsights {
  stages: Record<Stage, number>;
  /** At risk or Lost Customers who had bought 3 or more times: the ones most worth a win-back offer. */
  loyalAtRisk: number;
  /** Of Customers who ever bought, the share who bought again. */
  repeatRate: number | null;
  medianDaysBetweenOrders: number | null;
  buyersInPeriod: number;
  returningBuyersInPeriod: number;
  seniorPwdShare: number | null;
  valueBuckets: ValueBucket[];
  top: TopCustomer[];
}

export const LOYAL_ORDERS = 3;
const BUCKETS: [string, number][] = [["Under ₱500", 50_000], ["₱500–₱999", 100_000], ["₱1,000–₱2,499", 250_000], ["₱2,500–₱4,999", 500_000], ["₱5,000 and up", Infinity]];

export async function customerInsightsIn(sql: postgres.Sql, period: Period, now: Date): Promise<CustomerInsights> {
  const rows = await sql<{ id: string; name: string; orders: number; spent: string; last_order: Date | null; in_period: number; first_order: Date | null }[]>`
    select c.id, c.full_name as name,
      count(o.id)::int as orders,
      coalesce(sum(o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0)), 0)::bigint as spent,
      max(o.created_at) as last_order, min(o.created_at) as first_order,
      count(o.id) filter (where o.created_at >= ${period.start} and o.created_at < ${period.end})::int as in_period
    from public.customers c
    join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
    left join public.orders o on o.customer_id = c.id and o.status = any(${PAID_OR_FULFILLED}) and ${notReplacement(sql, "o")}
    where to_jsonb(c)->>'deleted_at' is null
    group by c.id, c.full_name`;

  const stages: Record<Stage, number> = { new: 0, "first-order": 0, repeat: 0, "at-risk": 0, lost: 0 };
  const buckets = BUCKETS.map(([label]) => ({ label, customers: 0 }));
  let loyalAtRisk = 0, buyers = 0, repeaters = 0, buyersInPeriod = 0, returningBuyersInPeriod = 0;
  for (const row of rows) {
    const stage = stageOf({ orders: row.orders, lastOrder: row.last_order }, now);
    stages[stage]++;
    if ((stage === "at-risk" || stage === "lost") && row.orders >= LOYAL_ORDERS) loyalAtRisk++;
    if (row.orders === 0) continue;
    buyers++;
    if (row.orders > 1) repeaters++;
    if (row.in_period > 0) {
      buyersInPeriod++;
      if (row.first_order && row.first_order < period.start) returningBuyersInPeriod++;
    }
    buckets[BUCKETS.findIndex(([, under]) => Number(row.spent) < under)].customers++;
  }

  const top = rows.filter((r) => r.orders > 0 && r.last_order)
    .sort((a, b) => Number(b.spent) - Number(a.spent) || b.orders - a.orders || a.name.localeCompare(b.name))
    .slice(0, 10)
    .map((r) => ({ id: r.id, name: r.name, orders: r.orders, spent: Number(r.spent), lastOrder: r.last_order! }));

  const [gap] = await sql<{ days: string | null }[]>`
    select percentile_cont(0.5) within group (order by extract(epoch from gap) / 86400) as days from (
      select o.created_at - lag(o.created_at) over (partition by o.customer_id order by o.created_at) as gap
      from public.orders o where o.status = any(${PAID_OR_FULFILLED}) and ${notReplacement(sql, "o")}
    ) g where gap is not null`;

  const [senior] = await sql<{ orders: number; senior: number }[]>`
    select count(*)::int as orders, count(*) filter (where o.senior_pwd_verification_id is not null)::int as senior
    from public.orders o
    where o.status = any(${PAID_OR_FULFILLED}) and ${notReplacement(sql, "o")}
      and o.created_at >= ${period.start} and o.created_at < ${period.end}`;

  return {
    stages,
    loyalAtRisk,
    repeatRate: buyers === 0 ? null : repeaters / buyers,
    medianDaysBetweenOrders: gap.days === null ? null : Math.round(Number(gap.days)),
    buyersInPeriod,
    returningBuyersInPeriod,
    seniorPwdShare: senior.orders === 0 ? null : senior.senior / senior.orders,
    valueBuckets: buckets,
    top,
  };
}
