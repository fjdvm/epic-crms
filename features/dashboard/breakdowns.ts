import type postgres from "postgres";

import { PAID_OR_FULFILLED } from "@/features/customer-profiles/rules";
import type { Span } from "./period";

export type Breakdown<T> = ({ ok: true } & T) | { ok: false };

export interface BestSellers {
  products: { productName: string; sales: number; units: number; share: number | null }[];
  /** Other products and Delivery fees, so products plus remainder reconcile to Sales. Centavos. */
  remainder: { sales: number; share: number | null };
}

export interface MonthlyBuyers {
  months: { label: string; soFar: boolean; new: number; returning: number; share: number | null }[];
}

export interface PaymentAndReceiving {
  payment: { method: string; orders: number; sales: number }[];
  receiving: { method: string; orders: number; sales: number }[];
}

/** Refunded whole line items reduce both money and units. Sizes of the same product are combined. */
export async function bestSellersIn(sql: postgres.Sql, span: Span, sales: number): Promise<BestSellers> {
  const rows = await sql<{ product_name: string; sales: string; units: string }[]>`
    select l.product_name,
      sum(l.price_in_centavos::bigint * (l.quantity - coalesce(r.quantity, 0)))::bigint as sales,
      sum(l.quantity - coalesce(r.quantity, 0))::bigint as units
    from public.order_lines l
    join public.orders o on o.id = l.order_id
    left join (
      select i.order_line_id, sum(i.quantity) as quantity
      from public.order_return_items i
      join public.order_returns r on r.id = i.return_id
      where r.status = 'refunded'
      group by i.order_line_id
    ) r on r.order_line_id = l.id
    where o.status = any(${PAID_OR_FULFILLED}) and o.created_at >= ${span.start} and o.created_at < ${span.end}
    group by l.product_name
    having sum(l.quantity - coalesce(r.quantity, 0)) > 0
    order by sales desc, l.product_name asc
    limit 4`;
  const share = (amount: number) => sales === 0 ? null : amount / sales;
  const products = rows.map((row) => ({
    productName: row.product_name, sales: Number(row.sales), units: Number(row.units), share: share(Number(row.sales)),
  }));
  const remainder = sales - products.reduce((sum, product) => sum + product.sales, 0);

  return { products, remainder: { sales: remainder, share: share(remainder) } };
}

/** Both breakdowns count only Orders counted in Sales, using the stored methods and net Order totals. */
export async function paymentAndReceivingIn(sql: postgres.Sql, span: Span): Promise<PaymentAndReceiving> {
  const rows = await sql<{ payment_method: string; fulfillment_method: string; orders: number; sales: string }[]>`
    select o.payment_method, o.fulfillment_method, count(*)::int as orders,
      sum(o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0)
        - coalesce((select sum(r.amount_in_centavos) from public.order_returns r
            where r.order_id = o.id and r.status = 'refunded'), 0))::bigint as sales
    from public.orders o
    where o.status = any(${PAID_OR_FULFILLED}) and o.created_at >= ${span.start} and o.created_at < ${span.end}
    group by o.payment_method, o.fulfillment_method`;
  const group = (field: "payment_method" | "fulfillment_method") => {
    const grouped = new Map<string, { method: string; orders: number; sales: number }>();
    for (const row of rows) {
      const method = row[field];
      const entry = grouped.get(method) ?? { method, orders: 0, sales: 0 };
      entry.orders += row.orders;
      entry.sales += Number(row.sales);
      grouped.set(method, entry);
    }
    return [...grouped.values()].sort((a, b) => a.method.localeCompare(b.method));
  };

  return { payment: group("payment_method"), receiving: group("fulfillment_method") };
}

interface SalesSnapshot {
  sales: number;
  bestSellers: Breakdown<BestSellers>;
  paymentAndReceiving: Breakdown<PaymentAndReceiving>;
}

/** Prime dependent aggregates together even when the caller may only see the Sales tile. */
export async function salesSnapshotIn(sql: postgres.Sql, span: Span): Promise<SalesSnapshot> {
  const key = `sales-snapshot:${span.start.toISOString()}:${span.end.toISOString()}`;
  const snapshot = await cachedAnalytics(sql, key, async () => {
    const [row] = await sql<{ sales: string }[]>`
      select coalesce(sum(
        o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0)
          - coalesce((select sum(r.amount_in_centavos) from public.order_returns r
              where r.order_id = o.id and r.status = 'refunded'), 0)
      ), 0)::bigint as sales
      from public.orders o
      where o.status = any(${PAID_OR_FULFILLED}) and o.created_at >= ${span.start} and o.created_at < ${span.end}`;
    const sales = Number(row.sales);
    const [bestSellers, paymentAndReceiving] = await Promise.all([
      readBreakdown(() => bestSellersIn(sql, span, sales)),
      readBreakdown(() => paymentAndReceivingIn(sql, span)),
    ]);
    return { sales, bestSellers, paymentAndReceiving };
  });
  // Preserve independent failures, but let a failed aggregate recover on the next request.
  if (!snapshot.bestSellers.ok || !snapshot.paymentAndReceiving.ok) caches.get(sql)?.delete(key);
  return snapshot;
}

async function readBreakdown<T extends object>(read: () => Promise<T>): Promise<Breakdown<T>> {
  try {
    return { ok: true, ...await read() };
  } catch {
    return { ok: false };
  }
}

/** Per database, bounded to the active five-minute window; never caches Staff Modules or live queues. */
const caches = new WeakMap<postgres.Sql, Map<string, { expires: number; value: Promise<unknown> }>>();

export async function cachedAnalytics<T>(sql: postgres.Sql, key: string, read: () => Promise<T>): Promise<T> {
  const cache = caches.get(sql) ?? new Map();
  caches.set(sql, cache);
  const now = Date.now();
  for (const [key, entry] of cache) if (entry.expires <= now) cache.delete(key);
  let entry = cache.get(key);
  if (!entry) {
    // Limit memory even if callers supply arbitrary periods during the cache window.
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    entry = { expires: (Math.floor(now / 300_000) + 1) * 300_000, value: read() };
    cache.set(key, entry);
    const pending = entry;
    void entry.value.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
  }
  return await entry.value as T;
}

export async function loadBreakdown<T extends object>(
  connect: () => postgres.Sql, key: string, read: (sql: postgres.Sql) => Promise<T>,
): Promise<Breakdown<T>> {
  try {
    const sql = connect();
    return { ok: true, ...await cachedAnalytics(sql, key, () => read(sql)) };
  } catch {
    return { ok: false };
  }
}

/** Snapshot failures are reported on each widget rather than failing the Dashboard. */
export async function loadSalesBreakdown<K extends "bestSellers" | "paymentAndReceiving">(
  connect: () => postgres.Sql, span: Span, key: K,
): Promise<SalesSnapshot[K]> {
  try {
    return (await salesSnapshotIn(connect(), span))[key];
  } catch {
    return { ok: false };
  }
}
