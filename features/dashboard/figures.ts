import type postgres from "postgres";

import { PAID_OR_FULFILLED } from "@/features/customer-profiles/rules";
import { CUSTOMER_PROFILES_MODULE, FEEDBACK_MODULE, ORDERS_MODULE, PAYMENTS_MODULE } from "@/lib/portal/config";

import { loadAttention, type Attention } from "./attention";
import {
  bestSellersIn, cachedAnalytics, forgetAnalytics, loadBreakdown, paymentAndReceivingIn,
  type BestSellers, type Breakdown, type MonthlyBuyers, type PaymentAndReceiving,
} from "./breakdowns";
import { customersByStageAt, newCustomersIn, unverifiedLeads, type CustomersByStage } from "./customers";
import { lastSixMonths, type Period, type SalesMonth, type Span } from "./period";

/** One widget's figure for the period and the one before it, or the fact that it could not be read. */
export type Widget<T = number> = { ok: true; current: T; previous: T } | { ok: false };

export interface RatingFigure {
  /** Mean stars, or none when no Feedback was given. */
  average: number | null;
  count: number;
}

export interface BuyersFigure {
  /** Share of Buyers who are Returning, 0 to 1, or none when there are no Buyers. */
  share: number | null;
  buyers: number;
}

export interface MonthlySales {
  months: (SalesMonth & { sales: number })[];
}

/** A widget is present only when the Staff member holds the Module of its data. */
export interface DashboardFigures {
  /** Centavos. */
  sales?: Widget;
  orders?: Widget;
  /** Centavos. */
  averageOrder?: Widget;
  averageRating?: Widget<RatingFigure>;
  returningBuyers?: Widget<BuyersFigure>;
  /** The last six months, whatever the chosen period. */
  monthlySales?: ({ ok: true } & MonthlySales) | { ok: false };
  /** The Needs attention queues, always read live and never cached. */
  attention?: Attention;
  /** Stage and At risk are as of now, regardless of the selected period. */
  customersByStage?: Breakdown<CustomersByStage>;
  atRisk?: Breakdown<{ count: number }>;
  newCustomers?: Widget;
  unverifiedLeads?: Breakdown<{ count: number }>;
  bestSellers?: Breakdown<BestSellers>;
  monthlyBuyers?: Breakdown<MonthlyBuyers>;
  paymentAndReceiving?: Breakdown<PaymentAndReceiving>;
}

/** The Total spent rule across all Customers: paid and fulfilled Orders less Refunded Return amounts. */
export async function salesIn(sql: postgres.Sql, span: Span): Promise<number> {
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

export async function ordersIn(sql: postgres.Sql, span: Span): Promise<number> {
  const [row] = await sql<{ orders: number }[]>`
    select count(*)::int as orders from public.orders
    where status <> 'cancelled' and created_at >= ${span.start} and created_at < ${span.end}`;

  return row.orders;
}

/** Sales divided by the Orders counted in Sales (not all Orders), in whole centavos. */
export async function averageOrderIn(sql: postgres.Sql, span: Span): Promise<number> {
  const [row] = await sql<{ counted: number }[]>`
    select count(*)::int as counted from public.orders
    where status = any(${PAID_OR_FULFILLED}) and created_at >= ${span.start} and created_at < ${span.end}`;
  return row.counted === 0 ? 0 : Math.round((await salesIn(sql, span)) / row.counted);
}

/** Feedback is dated by when it was given, not by its Order. */
export async function averageRatingIn(sql: postgres.Sql, span: Span): Promise<RatingFigure> {
  const [row] = await sql<{ average: number | null; count: number }[]>`
    select avg(rating)::float8 as average, count(*)::int as count from public.order_feedback
    where created_at >= ${span.start} and created_at < ${span.end}`;

  return { average: row.average, count: row.count };
}

/** A Buyer is Returning if they had an Order counted in Sales before the period; each is counted once. */
export async function returningBuyersIn(sql: postgres.Sql, span: Span): Promise<BuyersFigure> {
  const [row] = await sql<{ buyers: number; returning: number }[]>`
    select count(*)::int as buyers, (count(*) filter (where b.returning))::int as returning
    from (
      select o.customer_id, exists (
        select 1 from public.orders p
        where p.customer_id = o.customer_id and p.status = any(${PAID_OR_FULFILLED}) and p.created_at < ${span.start}
      ) as returning
      from public.orders o
      where o.status = any(${PAID_OR_FULFILLED}) and o.created_at >= ${span.start} and o.created_at < ${span.end}
      group by o.customer_id
    ) b`;

  return { share: row.buyers === 0 ? null : row.returning / row.buyers, buyers: row.buyers };
}

async function monthlySalesAt(sql: postgres.Sql, now: Date): Promise<MonthlySales> {
  const months = await Promise.all(
    lastSixMonths(now).map(async (month) => ({ ...month, sales: await salesIn(sql, month) })),
  );

  return { months };
}

/** Runs on its own so one widget failing leaves the others standing. */
export async function loadWidget<T = number>(
  connect: () => postgres.Sql,
  period: Period,
  figure: (sql: postgres.Sql, span: Span) => Promise<T>,
): Promise<Widget<T>> {
  try {
    const sql = connect();
    const [current, previous] = await Promise.all([figure(sql, period), figure(sql, period.previous)]);

    return { ok: true, current, previous };
  } catch {
    return { ok: false };
  }
}

/** Which tiles Staff may see: a widget shows only if they hold the Module of the data it summarises. */
export function visibleWidgets(modules: readonly string[]) {
  const sales = modules.includes(ORDERS_MODULE) || modules.includes(PAYMENTS_MODULE);

  return {
    sales,
    orders: modules.includes(ORDERS_MODULE),
    averageOrder: sales,
    returningBuyers: modules.includes(ORDERS_MODULE),
    averageRating: modules.includes(FEEDBACK_MODULE),
    monthlySales: sales,
    breakdowns: modules.includes(ORDERS_MODULE),
    customers: modules.includes(CUSTOMER_PROFILES_MODULE),
  };
}

async function loadDashboardAnalytics(
  connect: () => postgres.Sql,
  { period, modules, now = new Date() }: { period: Period; modules: readonly string[]; now?: Date },
): Promise<DashboardFigures> {
  const visible = visibleWidgets(modules);

  const [sales, orders, averageOrder, averageRating, returningBuyers, monthlySales,
    bestSellers, monthlyBuyers, paymentAndReceiving, newCustomers, leads, customersByStage] = await Promise.all([
    visible.sales ? loadWidget(connect, period, salesIn) : undefined,
    visible.orders ? loadWidget(connect, period, ordersIn) : undefined,
    visible.averageOrder ? loadWidget(connect, period, averageOrderIn) : undefined,
    visible.averageRating ? loadWidget(connect, period, averageRatingIn) : undefined,
    visible.returningBuyers ? loadWidget(connect, period, returningBuyersIn) : undefined,
    visible.monthlySales ? loadMonthlySales(connect, now) : undefined,
    visible.breakdowns ? loadBreakdown(connect, async (sql) => bestSellersIn(sql, period, await salesIn(sql, period))) : undefined,
    visible.breakdowns ? loadBreakdown(connect, async (sql) => {
      const months = await Promise.all(lastSixMonths(now).map(async (month) => {
        const buyers = await returningBuyersIn(sql, month);
        const returning = Math.round((buyers.share ?? 0) * buyers.buyers);
        return { label: month.label, soFar: month.soFar, new: buyers.buyers - returning, returning, share: buyers.share };
      }));
      return { months: months.some((month) => month.new + month.returning > 0) ? months : [] };
    }) : undefined,
    visible.breakdowns ? loadBreakdown(connect, (sql) => paymentAndReceivingIn(sql, period)) : undefined,
    visible.customers ? loadWidget(connect, period, newCustomersIn) : undefined,
    visible.customers ? loadBreakdown(connect, unverifiedLeads) : undefined,
    visible.customers ? loadBreakdown(connect, (sql) => customersByStageAt(sql, now)) : undefined,
  ]);

  return {
    ...(customersByStage && {
      customersByStage,
      atRisk: customersByStage.ok ? { ok: true as const, count: customersByStage.counts["at-risk"] } : { ok: false as const },
    }),
    ...(newCustomers && { newCustomers }),
    ...(leads && { unverifiedLeads: leads }),
    ...(sales && { sales }),
    ...(orders && { orders }),
    ...(averageOrder && { averageOrder }),
    ...(averageRating && { averageRating }),
    ...(returningBuyers && { returningBuyers }),
    ...(monthlySales && { monthlySales }),
    ...(bestSellers && { bestSellers }),
    ...(monthlyBuyers && { monthlyBuyers }),
    ...(paymentAndReceiving && { paymentAndReceiving }),
  };
}

async function loadMonthlySales(connect: () => postgres.Sql, now: Date): Promise<NonNullable<DashboardFigures["monthlySales"]>> {
  try {
    return { ok: true, ...(await monthlySalesAt(connect(), now)) };
  } catch {
    return { ok: false };
  }
}

/** Cache the permitted analytics together; a different Module set gets its own coherent snapshot. */
export async function loadDashboardFigures(
  connect: () => postgres.Sql,
  { period, modules, now = new Date() }: { period: Period; modules: readonly string[]; now?: Date },
): Promise<DashboardFigures> {
  const options = { period, modules, now };
  const analytics = async () => {
    if (!Object.values(visibleWidgets(modules)).some(Boolean)) return {};
    let sql: postgres.Sql;
    try { sql = connect(); } catch { return loadDashboardAnalytics(connect, options); }
    const key = JSON.stringify([
      visibleWidgets(modules), period, lastSixMonths(now)[5].label,
      new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
    ]);
    const result = await cachedAnalytics(sql, key, () => loadDashboardAnalytics(connect, options));
    if (Object.values(result).some((widget) => widget && "ok" in widget && !widget.ok)) forgetAnalytics(sql, key);
    return result;
  };
  const [figures, attention] = await Promise.all([analytics(), loadAttention(connect, { modules, now })]);
  return { ...figures, attention };
}
