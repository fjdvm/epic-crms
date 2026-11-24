import type postgres from "postgres";

import { PAID_OR_FULFILLED } from "@/features/customer-profiles/rules";
import type { Period } from "@/features/dashboard/period";
import { notReplacement } from "@/lib/replacement-order";

export interface MethodFigures { method: string; orders: number; sales: number; previousOrders: number }
export interface AgeBucket { key: "under-1-day" | "1-to-3-days" | "over-3-days"; orders: number; value: number }

/** Money in centavos, times in hours. */
export interface PaymentInsights {
  methods: MethodFigures[];
  /** From the first Payment proof to Paid, for Orders marked Paid in the period. */
  verify: { orders: number; medianHours: number | null; slowestHours: number | null; weekdayMedianHours: number | null; weekendMedianHours: number | null };
  proofs: { submitted: number; rejected: number; reusedReference: number };
  /** Right now, whatever the period: Orders waiting for an online payment. */
  unpaid: AgeBucket[];
  refunds: { count: number; amount: number; reasons: { label: string; count: number }[] };
  /** Orders that paid a Delivery fee with a subtotal within 20% under the free-delivery threshold they saw. */
  nearFreeDelivery: { orders: number; eligible: number };
}

const hours = (value: number | string | null) => (value === null ? null : Math.round(Number(value) * 10) / 10);
const DAY = 24 * 60 * 60 * 1000;

export async function paymentInsightsIn(sql: postgres.Sql, period: Period, now: Date): Promise<PaymentInsights> {
  const methods = await sql<{ method: string; current: boolean; orders: number; sales: string }[]>`
    select o.payment_method as method, o.created_at >= ${period.start} as current, count(*)::int as orders,
      sum(o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0))::bigint as sales
    from public.orders o
    where o.status = any(${PAID_OR_FULFILLED}) and ${notReplacement(sql, "o")}
      and o.created_at >= ${period.previous.start} and o.created_at < ${period.end}
    group by 1, 2`;
  const byMethod = new Map<string, MethodFigures>();
  for (const row of methods) {
    const entry = byMethod.get(row.method) ?? { method: row.method, orders: 0, sales: 0, previousOrders: 0 };
    if (row.current) { entry.orders += row.orders; entry.sales += Number(row.sales); } else entry.previousOrders += row.orders;
    byMethod.set(row.method, entry);
  }

  const [verify] = await sql<{ orders: number; median: string | null; slowest: string | null; weekday: string | null; weekend: string | null }[]>`
    with v as (
      select extract(epoch from o.paid_at - s.first_at) / 3600 as hours,
        extract(dow from s.first_at at time zone 'Asia/Manila') in (0, 6) as weekend
      from public.orders o
      join lateral (
        select coalesce(min(p.submitted_at), o.payment_proof_submitted_at) as first_at
        from public.order_payment_proofs p where p.order_id = o.id
      ) s on true
      where o.paid_at >= ${period.start} and o.paid_at < ${period.end} and s.first_at is not null and o.paid_at >= s.first_at
    )
    select count(*)::int as orders,
      percentile_cont(0.5) within group (order by hours) as median,
      max(hours) as slowest,
      percentile_cont(0.5) within group (order by hours) filter (where not weekend) as weekday,
      percentile_cont(0.5) within group (order by hours) filter (where weekend) as weekend
    from v`;

  const [proofs] = await sql<{ submitted: number; rejected: number; reused: number }[]>`
    select count(*)::int as submitted,
      count(*) filter (where p.rejected_at is not null)::int as rejected,
      count(*) filter (where nullif(trim(p.reference), '') is not null and exists (
        select 1 from public.order_payment_proofs q
        where q.order_id <> p.order_id and lower(trim(q.reference)) = lower(trim(p.reference))))::int as reused
    from public.order_payment_proofs p
    where p.submitted_at >= ${period.start} and p.submitted_at < ${period.end}`;

  const waiting = await sql<{ created_at: Date; value: number }[]>`
    select o.created_at, (o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0))::int as value
    from public.orders o
    where o.status in ('placed', 'confirmed') and o.payment_method <> 'cash-on-delivery' and o.paid_at is null
      and ${notReplacement(sql, "o")}`;
  const unpaid: AgeBucket[] = [
    { key: "under-1-day", orders: 0, value: 0 }, { key: "1-to-3-days", orders: 0, value: 0 }, { key: "over-3-days", orders: 0, value: 0 },
  ];
  for (const row of waiting) {
    const age = now.getTime() - row.created_at.getTime();
    const bucket = unpaid[age < DAY ? 0 : age <= 3 * DAY ? 1 : 2];
    bucket.orders++;
    bucket.value += row.value;
  }

  const refundRows = await sql<{ reason: string; count: number; amount: string }[]>`
    select r.reason, count(*)::int as count, sum(coalesce(r.refund_amount_in_centavos, r.amount_in_centavos))::bigint as amount
    from public.order_returns r
    where r.status = 'refunded' and r.refunded_at >= ${period.start} and r.refunded_at < ${period.end}
    group by r.reason order by count desc, r.reason`;

  const [near] = await sql<{ orders: number; eligible: number }[]>`
    select count(*) filter (where o.subtotal_in_centavos >= o.free_delivery_threshold_in_centavos * 0.8)::int as orders,
      count(*)::int as eligible
    from public.orders o
    where o.status = any(${PAID_OR_FULFILLED}) and ${notReplacement(sql, "o")}
      and o.created_at >= ${period.start} and o.created_at < ${period.end}
      and o.fulfillment_method = 'delivery' and not o.free_delivery
      and o.free_delivery_threshold_in_centavos > 0 and o.subtotal_in_centavos < o.free_delivery_threshold_in_centavos`;

  return {
    methods: [...byMethod.values()].sort((a, b) => b.orders - a.orders || a.method.localeCompare(b.method)),
    verify: {
      orders: verify.orders, medianHours: hours(verify.median), slowestHours: hours(verify.slowest),
      weekdayMedianHours: hours(verify.weekday), weekendMedianHours: hours(verify.weekend),
    },
    proofs: { submitted: proofs.submitted, rejected: proofs.rejected, reusedReference: proofs.reused },
    unpaid,
    refunds: {
      count: refundRows.reduce((s, r) => s + r.count, 0),
      amount: refundRows.reduce((s, r) => s + Number(r.amount), 0),
      reasons: refundRows.map((r) => ({ label: r.reason, count: r.count })),
    },
    nearFreeDelivery: near,
  };
}
