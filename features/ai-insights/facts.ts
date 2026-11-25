import type postgres from "postgres";

import { PAID_OR_FULFILLED } from "@/features/customer-profiles/rules";
import { openComplaintThemes } from "@/features/feedback/complaint-themes";
import { serviceLevel, targetsAt, type TargetHistory } from "@/features/tickets/service-level";
import { loadTargetHistory } from "@/features/tickets/service-level-store";
import { addressArea, areaName, cityKey, cityLabel } from "@/lib/geo/areas";
import { notReplacement } from "@/lib/replacement-order";

import {
  enoughData, RULES, type AreaFigures, type CityFigures, type CourierFigures, type ExpiringFigures, type InsightFacts, type PeriodDays,
  type PlaceFigures, type ReturnProduct, type SlaFigures, type StockFigures, type ThemeFigures,
} from "./insights";

export interface Sources { source: postgres.Sql; crms: postgres.Sql }
export interface Span { start: Date; end: Date; previous: { start: Date; end: Date } }

const DAY = 24 * 60 * 60 * 1000;
const OFFSET = 8 * 60 * 60 * 1000;

/** The last `days` whole Philippine days before today, and the same length before that. The morning run never counts a part day. */
export function periodSpan(days: PeriodDays, now: Date): Span {
  const manila = new Date(now.getTime() + OFFSET);
  const end = new Date(Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate()) - OFFSET);
  const start = new Date(end.getTime() - days * DAY);
  return { start, end, previous: { start: new Date(start.getTime() - days * DAY), end: start } };
}

/** A Philippine calendar date, YYYY-MM-DD. */
export const manilaDay = (at: Date) => new Date(at.getTime() + OFFSET).toISOString().slice(0, 10);

interface OrderRow {
  id: number; current: boolean; province: string | null; city: string | null; courier: string;
  delivery: boolean; free_delivery: boolean; went_out: boolean; late_or_failed: boolean; returned: boolean; complaints: number;
}

const blank = (key: string, name: string): PlaceFigures => ({
  key, name, orders: 0, previousOrders: 0, wentOut: 0, lateOrFailed: 0, previousWentOut: 0, previousLateOrFailed: 0,
  returned: 0, complaints: 0, deliveries: 0, freeDelivery: 0,
});

function add(place: PlaceFigures, row: OrderRow) {
  if (!row.current) {
    place.previousOrders++;
    if (row.went_out) { place.previousWentOut++; if (row.late_or_failed) place.previousLateOrFailed++; }
    return;
  }
  place.orders++;
  if (row.went_out) { place.wentOut++; if (row.late_or_failed) place.lateOrFailed++; }
  if (row.returned) place.returned++;
  place.complaints += row.complaints;
  if (row.delivery) { place.deliveries++; if (row.free_delivery) place.freeDelivery++; }
}

/**
 * Orders counted in Sales, by delivery area and city, by courier, now and in the period before. Aggregated to city:
 * no Customer, street or barangay leaves this function.
 */
export async function orderFactsIn(sql: postgres.Sql, span: Span, now: Date) {
  // Read through to_jsonb, like the Fulfilment report, so this works before the storefront adds the column.
  const dispatchedAt = sql`(to_jsonb(o)->>'dispatched_at')::timestamptz`;
  const rows = await sql<OrderRow[]>`
    select o.id, o.created_at >= ${span.start} as current, a.province, a.city,
      coalesce(nullif(trim(o.courier), ''), 'Not recorded') as courier,
      o.fulfillment_method = 'delivery' as delivery, o.free_delivery,
      (o.fulfillment_method = 'delivery' and (${dispatchedAt} is not null or o.status in ('dispatched', 'delivered', 'received'))) as went_out,
      (exists (select 1 from public.failed_deliveries f where f.order_id = o.id)
        or coalesce(o.delivered_at, ${now}) - coalesce(o.paid_at, o.created_at) > ${RULES.lateHours} * interval '1 hour') as late_or_failed,
      exists (select 1 from public.order_returns r where r.order_id = o.id) as returned,
      (select count(*) from public.tickets t where t.order_id = o.id)::int as complaints
    from public.orders o
    left join public.order_delivery_addresses a on a.order_id = o.id
    where o.status = any(${PAID_OR_FULFILLED}) and ${notReplacement(sql, "o")}
      and o.created_at >= ${span.previous.start} and o.created_at < ${span.end}
    order by o.created_at desc, o.id desc`;

  const areas = new Map<string, AreaFigures & { byCity: Map<string, CityFigures> }>();
  const couriers = new Map<string, CourierFigures>();
  const lateByCity = new Map<string, number[]>();
  let orders = 0, previousOrders = 0, wentOut = 0, lateOrFailed = 0, returnedOrders = 0, unmapped = 0;

  for (const row of rows) {
    if (row.current) {
      orders++;
      if (row.went_out) { wentOut++; if (row.late_or_failed) lateOrFailed++; }
      if (row.returned) returnedOrders++;
    } else previousOrders++;

    if (row.went_out) {
      const c = couriers.get(row.courier) ?? { courier: row.courier, wentOut: 0, lateOrFailed: 0, previousWentOut: 0, previousLateOrFailed: 0, orderIds: [] };
      if (row.current) { c.wentOut++; if (row.late_or_failed) { c.lateOrFailed++; c.orderIds.push(row.id); } }
      else { c.previousWentOut++; if (row.late_or_failed) c.previousLateOrFailed++; }
      couriers.set(row.courier, c);
    }

    const key = row.province !== null ? addressArea(row.province, row.city ?? "") : null;
    if (!key) { if (row.current && row.delivery) unmapped++; continue; }
    let area = areas.get(key);
    if (!area) areas.set(key, (area = { ...blank(key, areaName(key)), cities: [], byCity: new Map() }));
    add(area, row);
    const name = cityLabel(row.city ?? "");
    if (!name) continue;
    const placeKey = `${key}|${cityKey(name)}`;
    let city = area.byCity.get(placeKey);
    if (!city) area.byCity.set(placeKey, (city = { ...blank(placeKey, name), province: key }));
    add(city, row);
    if (row.current && row.went_out && row.late_or_failed) lateByCity.set(placeKey, [...(lateByCity.get(placeKey) ?? []), row.id]);
  }

  const byOrders = <T extends PlaceFigures>(a: T, b: T) => b.orders - a.orders || b.previousOrders - a.previousOrders || a.name.localeCompare(b.name);
  return {
    orders, previousOrders, wentOut, lateOrFailed, returnedOrders, unmapped,
    areas: [...areas.values()].map(({ byCity, ...area }) => ({ ...area, cities: [...byCity.values()].sort(byOrders) })).sort(byOrders),
    couriers: [...couriers.values()].sort((a, b) => b.wentOut - a.wentOut || a.courier.localeCompare(b.courier)),
    lateOrFailedByCity: [...lateByCity].map(([key, orderIds]) => ({ key, orderIds })),
  };
}

/** Units sold and returned per product in the period, with the Returns behind each. Declined and cancelled Returns do not count. */
export async function returnFactsIn(sql: postgres.Sql, span: Span) {
  const between = (column: postgres.PendingQuery<postgres.Row[]>) => sql`${column} >= ${span.start} and ${column} < ${span.end}`;
  const sold = await sql<{ product: string; units: number }[]>`
    select l.product_name as product, sum(l.quantity)::int as units from public.order_lines l join public.orders o on o.id = l.order_id
    where o.status = any(${PAID_OR_FULFILLED}) and ${notReplacement(sql, "o")} and ${between(sql`o.created_at`)}
    group by l.product_name`;
  const returned = await sql<{ product: string; units: number; ids: number[] }[]>`
    select i.product_name as product, sum(i.quantity)::int as units, array_agg(distinct r.id) as ids
    from public.order_return_items i join public.order_returns r on r.id = i.return_id
    where ${between(sql`r.requested_at`)} and r.status not in ('declined', 'cancelled')
    group by i.product_name`;
  const [requested] = await sql<{ count: number }[]>`
    select count(*)::int as count from public.order_returns r where ${between(sql`r.requested_at`)}`;
  const units = new Map(sold.map((s) => [s.product, s.units]));
  const products: ReturnProduct[] = returned.map((r) => ({
    product: r.product, sold: units.get(r.product) ?? 0, returned: r.units, returnIds: [...r.ids].map(Number).sort((a, b) => b - a),
  }));
  return {
    requested: requested.count,
    returns: { sold: sold.reduce((s, r) => s + r.units, 0), returned: returned.reduce((s, r) => s + r.units, 0), products },
  };
}

export const STOCK_SALES_DAYS = 14;
export const STOCK_WARN_DAYS = 5;

/**
 * Sizes that will run out within STOCK_WARN_DAYS at the last two weeks' selling speed, with the Orders that sold them.
 * Read-only: the count is the IMS's (crms.stock_count); CREOMS never changes it.
 */
export async function stockFactsAt({ source, crms }: Sources, now: Date): Promise<StockFigures[]> {
  const since = new Date(now.getTime() - STOCK_SALES_DAYS * DAY);
  const sold = await source<{ ims_product_id: number; units: number; ids: number[] }[]>`
    select s.ims_product_id, sum(l.quantity)::int as units, array_agg(distinct o.id) as ids
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
  const byId = new Map(sold.map((s) => [s.ims_product_id, s]));
  return stock
    .map((row) => {
      const s = byId.get(row.ims_product_id)!;
      const perDay = s.units / STOCK_SALES_DAYS;
      const available = row.available ?? 0;
      return {
        key: String(row.ims_product_id), name: row.variant ? `${row.name} ${row.variant}` : row.name, available,
        soldPerDay: Math.round(perDay * 10) / 10, days: perDay > 0 ? available / perDay : Infinity, unitsSold: s.units,
        orderIds: [...s.ids].map(Number).sort((a, b) => b - a),
      };
    })
    .filter((row) => row.days < STOCK_WARN_DAYS)
    .sort((a, b) => a.days - b.days || a.name.localeCompare(b.name))
    .map(({ days, ...row }) => ({ ...row, daysLeft: Math.floor(days) }));
}

/**
 * Online-payment Orders the storefront will cancel at their payment deadline within the next 24 hours. The same rule
 * as the storefront's expiry: confirmed, or awaiting payment with no proof waiting to be checked (a proof pauses it);
 * the deadline is the one saved at confirmation, or 24 hours after confirmation for older Orders.
 */
export async function expiringFactsAt(sql: postgres.Sql, now: Date): Promise<ExpiringFigures> {
  const deadline = sql`coalesce((to_jsonb(o)->>'payment_deadline_at')::timestamptz, (to_jsonb(o)->>'confirmed_at')::timestamptz + interval '24 hours')`;
  const rows = await sql<{ id: number; value: number; deadline: Date }[]>`
    select o.id, (o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0))::int as value, ${deadline} as deadline
    from public.orders o
    where o.payment_method <> 'cash-on-delivery' and o.paid_at is null and ${notReplacement(sql, "o")}
      and (o.status = 'confirmed' or (o.status = 'awaiting payment'
        and (o.payment_proof_submitted_at is null or o.payment_proof_rejected_at is not null)))
      and ${deadline} > ${now} and ${deadline} <= ${new Date(now.getTime() + RULES.expiringHours * 60 * 60 * 1000)}
    order by deadline, o.id`;
  return {
    orders: rows.length, value: rows.reduce((s, r) => s + r.value, 0), orderIds: rows.map((r) => r.id),
    soonestHours: rows.length ? Math.max(0, Math.floor((rows[0].deadline.getTime() - now.getTime()) / 3_600_000)) : null,
  };
}

/** Open Tickets with no reply from the team yet whose first-reply clock (stopped while On hold) is mostly used up. */
export async function slaFactsAt(source: postgres.Sql, history: TargetHistory, now: Date): Promise<SlaFigures> {
  const tickets = await source<{ id: number; status: "open" | "on_hold"; created_at: Date; held_seconds: number; hold_started_at: Date | null }[]>`
    select t.id, t.status, t.created_at, t.held_seconds, t.hold_started_at from public.tickets t
    where t.status in ('open', 'on_hold')`;
  const messages = tickets.length
    ? await source<{ ticket_id: number; sender: "customer" | "staff"; created_at: Date }[]>`
        select ticket_id, sender, created_at from public.ticket_messages
        where not internal and ticket_id in ${source(tickets.map((t) => t.id))} order by created_at, id`
    : [];
  const byTicket = new Map<number, { sender: "customer" | "staff"; at: Date }[]>();
  for (const m of messages) byTicket.set(m.ticket_id, [...(byTicket.get(m.ticket_id) ?? []), { sender: m.sender, at: m.created_at }]);

  const atRisk: { id: number; remaining: number }[] = [];
  let breaching = 0;
  for (const t of tickets) {
    const msgs = byTicket.get(t.id) ?? [];
    if (msgs.some((m) => m.sender === "staff")) continue;
    const targets = targetsAt(history, t.created_at);
    const clock = serviceLevel({
      status: t.status, createdAt: t.created_at, resolvedAt: null, heldSeconds: t.held_seconds, holdStartedAt: t.hold_started_at, messages: msgs,
    }, targets, now).firstReply;
    if (clock.state !== "running" && clock.state !== "breaching") continue;
    const remaining = clock.remainingSeconds ?? 0;
    if (remaining > targets.firstReplyHours * 3600 * (1 - RULES.slaUsedShare)) continue;
    atRisk.push({ id: t.id, remaining });
    if (clock.state === "breaching") breaching++;
  }
  atRisk.sort((a, b) => a.remaining - b.remaining || a.id - b.id);
  return { atRisk: atRisk.length, breaching, ticketIds: atRisk.map((t) => t.id), open: tickets.length };
}

/**
 * Repeated Ticket complaints, grouped by the Complaint themes model (it labels groups; counts come only from the IDs we
 * sent), then by the product and city of each Ticket's Order, worked out here.
 */
export async function themeFactsIn({ source, crms }: Sources, span: Span): Promise<ThemeFigures[] | null> {
  const from = manilaDay(span.start), to = manilaDay(new Date(span.end.getTime() - DAY));
  const result = await openComplaintThemes({ tickets: source, crms }, { role: "CREOMS Manager" }, { from, to }, { refresh: true });
  if (!result.themes) return null;
  const groups = result.themes.themes
    .map((t) => ({ label: t.label, ticketIds: t.items.filter((i) => i.source === "ticket").map((i) => i.recordId) }))
    .filter((t) => t.ticketIds.length >= RULES.themeMinTickets);
  const ids = [...new Set(groups.flatMap((g) => g.ticketIds))];
  const rows = ids.length
    ? await source<{ id: number; province: string | null; city: string | null; products: string[] | null }[]>`
        select t.id, a.province, a.city, (select array_agg(distinct l.product_name) from public.order_lines l where l.order_id = t.order_id) as products
        from public.tickets t left join public.order_delivery_addresses a on a.order_id = t.order_id
        where t.id in ${source(ids)}`
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const top = (values: (string | null)[]) => {
    const counts = new Map<string, number>();
    for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    const [best] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return best ? { name: best[0], count: best[1] } : null;
  };
  return groups.map((g) => {
    const product = top(g.ticketIds.flatMap((id) => byId.get(id)?.products ?? []));
    const area = top(g.ticketIds.map((id) => {
      const r = byId.get(id);
      return r?.city ? cityLabel(r.city) : null;
    }));
    return {
      label: g.label, ticketIds: [...g.ticketIds].sort((a, b) => b - a),
      product: product?.name ?? null, productTickets: product?.count ?? 0, area: area?.name ?? null, areaTickets: area?.count ?? 0,
    };
  });
}

/**
 * Everything both periods need. The "right now" facts (stock, payment deadlines, Ticket clocks) are read once and shared.
 * A part that cannot be read is null and its insights are left out; it never stops the rest.
 */
export async function loadFacts(sources: Sources, days: PeriodDays, now: Date,
  shared?: { stock: StockFigures[] | null; expiring: ExpiringFigures | null; sla: SlaFigures | null }): Promise<InsightFacts> {
  const span = periodSpan(days, now);
  const soft = <T>(p: Promise<T>) => p.catch(() => null);
  const [orders, returns, now_] = await Promise.all([
    orderFactsIn(sources.source, span, now),
    soft(returnFactsIn(sources.source, span)),
    shared ?? loadNowFacts(sources, now),
  ]);
  // Grouping Ticket themes asks a model, so it runs only when there is enough data for the page to show insights at all.
  const themes = enoughData(orders) ? await soft(themeFactsIn(sources, span)) : null;
  return {
    days, orders: orders.orders, previousOrders: orders.previousOrders, wentOut: orders.wentOut, lateOrFailed: orders.lateOrFailed,
    returnsRequested: returns?.requested ?? 0, returnedOrders: orders.returnedOrders, areas: orders.areas, unmapped: orders.unmapped,
    lateOrFailedByCity: orders.lateOrFailedByCity, couriers: orders.couriers,
    stock: now_.stock, expiring: now_.expiring, sla: now_.sla, returns: returns?.returns ?? null, themes,
  };
}

export async function loadNowFacts(sources: Sources, now: Date) {
  const soft = <T>(p: Promise<T>) => p.catch(() => null);
  const history = await loadTargetHistory(sources.crms).catch(() => null);
  const [stock, expiring, sla] = await Promise.all([
    soft(stockFactsAt(sources, now)),
    soft(expiringFactsAt(sources.source, now)),
    history ? soft(slaFactsAt(sources.source, history, now)) : Promise.resolve(null),
  ]);
  return { stock, expiring, sla };
}
