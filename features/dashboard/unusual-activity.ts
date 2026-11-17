import type postgres from "postgres";
import { DEFAULT_AUTOMATIC_CHECKS, loadAutomaticChecks, type AutomaticChecks } from "@/features/settings/automatic-checks";
import { MANAGER_AFTER_REJECTIONS } from "@/features/orders/payment-methods";
import type { Staff } from "@/lib/portal/client";
import { shopRole } from "@/lib/portal/roles";
import { PAYMENTS_MODULE, RETURNS_MODULE, FULFILMENT_MODULE } from "@/lib/portal/config";

/** The thresholds are Admin settings (Automatic checks); these are the defaults, which are today's behaviour. */
export const UNVERIFIED_PAYMENT_LIMIT = DEFAULT_AUTOMATIC_CHECKS.dashboard.unverifiedPayments.count;
export const UNVERIFIED_PAYMENT_WAIT_HOURS = DEFAULT_AUTOMATIC_CHECKS.dashboard.unverifiedPayments.waitHours;
export const RETURN_SPIKE_COUNT = DEFAULT_AUTOMATIC_CHECKS.dashboard.returnSpike.count;
export const RETURN_SPIKE_DAYS = DEFAULT_AUTOMATIC_CHECKS.dashboard.returnSpike.days;
export const FAILED_DELIVERY_COUNT = DEFAULT_AUTOMATIC_CHECKS.dashboard.unresolvedFailedDeliveries.count;
export const REJECTED_PROOF_WARNING = 2;
export const UNUSUAL_ACTIVITY_CARD_LIMIT = 5;
const HOUR = 3_600_000;

export const UNUSUAL_ACTIVITY_MODULES = [PAYMENTS_MODULE, RETURNS_MODULE, FULFILMENT_MODULE];
type Numbers = Record<string, number>;
export interface UnusualActivityCard {
  key: string;
  module: string;
  rule: string;
  numbers: Numbers;
  /** Ratio to the rule boundary; larger means more urgent. Ties use the stable key. */
  urgency: number;
  links: { label: string; href: string }[];
  /** Kept AI "why" and "what to do" (#484); absent until made, or when the model was unavailable. */
  explanation?: { why: string | null; whatToDo: string | null };
}
type Dependencies = { source: postgres.Sql; crms: postgres.Sql };
export interface UnusualActivity { cards: UnusualActivityCard[]; unavailable: string[] }

function visibleModules(staff: Staff, modules: readonly string[]) {
  const role = shopRole(staff.role);
  if (role === "admin" || role === "ceo") return UNUSUAL_ACTIVITY_MODULES;
  return role === "manager" ? UNUSUAL_ACTIVITY_MODULES.filter(m => modules.includes(m)) : [];
}
const orderLink = (id: number) => ({ label: `Order #${id}`, href: `/orders/${id}` });

type Dashboard = AutomaticChecks["dashboard"];

async function paymentCards(sql: postgres.Sql, now: Date, rules: Dashboard): Promise<UnusualActivityCard[]> {
  const { count: limit, waitHours } = rules.unverifiedPayments;
  const rows = await sql<{ id: number; payment_proof_submitted_at: Date }[]>`
    select id, payment_proof_submitted_at from public.orders
    where status = 'awaiting payment' and payment_method in ('gcash', 'maya', 'bank-transfer')
      and payment_proof_submitted_at <= ${now} and payment_proof_rejected_at is null
    order by payment_proof_submitted_at, id`;
  const cards: UnusualActivityCard[] = [];
  const oldestHours = rows.length ? Math.floor((+now - +rows[0].payment_proof_submitted_at) / HOUR) : 0;
  if (rules.unverifiedPayments.enabled && rows.length > 0 && (rows.length > limit || oldestHours >= waitHours)) {
    cards.push({ key: "unverified-payments", module: PAYMENTS_MODULE,
      rule: `More than ${limit} unverified payments or a proof waiting at least ${waitHours} hours`,
      numbers: { count: rows.length, oldestHours },
      urgency: Math.max(rows.length / (limit + 1), oldestHours / waitHours),
      links: rows.map(r => orderLink(r.id)) });
  }
  // The approval limit is per Order. Do not add unrelated Orders into a fictitious approval limit.
  const rejected = await sql<{ id: number; customer_id: string; payment_proof_rejections: number }[]>`
    select id, customer_id, payment_proof_rejections from public.orders
    where status = 'awaiting payment' and payment_method in ('gcash', 'maya', 'bank-transfer')
      and payment_proof_rejections >= ${REJECTED_PROOF_WARNING}
    order by customer_id, id`;
  const customers = new Map<string, (typeof rejected)[number][]>();
  for (const row of rejected) customers.set(row.customer_id, [...(customers.get(row.customer_id) ?? []), row]);
  for (const [customer, orders] of customers) {
    const count = Math.max(...orders.map(o => o.payment_proof_rejections));
    cards.push({ key: `rejected-proofs:${customer}`, module: PAYMENTS_MODULE,
      rule: `A Customer has an Order with at least ${REJECTED_PROOF_WARNING} rejected Payment proofs (Manager approval at ${MANAGER_AFTER_REJECTIONS})`,
      numbers: { count }, urgency: count / REJECTED_PROOF_WARNING,
      links: [{ label: "Customer", href: `/customer-profiles/${encodeURIComponent(customer)}` }, ...orders.map(o => orderLink(o.id))] });
  }
  return cards;
}

async function returnCards(sql: postgres.Sql, now: Date, rules: Dashboard): Promise<UnusualActivityCard[]> {
  const { count: spikeCount, days: spikeDays } = rules.returnSpike;
  if (!rules.returnSpike.enabled) return [];
  // Product names are the immutable snapshot identity available on Return items; sizes count together.
  const rows = await sql<{ product_name: string; return_id: number }[]>`
    select distinct i.product_name, r.id as return_id
    from public.order_returns r join public.order_return_items i on i.return_id = r.id
    where r.requested_at > ${new Date(+now - spikeDays * 24 * HOUR)} and r.requested_at <= ${now}
      and r.status not in ('declined', 'cancelled') order by i.product_name, r.id`;
  const products = new Map<string, number[]>();
  for (const row of rows) products.set(row.product_name, [...(products.get(row.product_name) ?? []), row.return_id]);
  return [...products].flatMap(([product, ids]) => ids.length < spikeCount ? [] : [{
    key: `return-spike:${product}`, module: RETURNS_MODULE,
    rule: `At least ${spikeCount} Returns for ${product} in the last ${spikeDays} days`,
    numbers: { count: ids.length, days: spikeDays }, urgency: ids.length / spikeCount,
    links: ids.map(id => ({ label: `Return #${id}`, href: `/returns/${id}` })),
  }]);
}

async function deliveryCards(sql: postgres.Sql, rules: Dashboard): Promise<UnusualActivityCard[]> {
  const { count: limit, enabled } = rules.unresolvedFailedDeliveries;
  if (!enabled) return [];
  const rows = await sql<{ order_id: number }[]>`
    select distinct f.order_id from public.failed_deliveries f join public.orders o on o.id = f.order_id
    where f.rebooked_at is null and f.disposition is null and o.status = 'dispatched'
      and o.fulfillment_method = 'delivery' order by f.order_id`;
  return rows.length < limit ? [] : [{
    key: "failed-deliveries", module: FULFILMENT_MODULE,
    rule: `At least ${limit} unresolved Failed deliveries, however long ago they happened`,
    numbers: { count: rows.length }, urgency: rows.length / limit,
    links: rows.map(r => ({ label: `Order #${r.order_id}`, href: `/orders/${r.order_id}/failed-delivery` })),
  }];
}

/** A larger observed number is worse. Recovery or identical numbers never clears a dismissal. */
function worsened(current: Numbers, dismissed: Numbers) {
  return Object.entries(current).some(([key, value]) => value > (dismissed[key] ?? value));
}

async function compute({ source, crms }: Dependencies, staff: Staff, modules: readonly string[], now: Date) {
  const held = visibleModules(staff, modules);
  const rules = (await loadAutomaticChecks(crms)).dashboard;
  const readers = [
    { module: PAYMENTS_MODULE, read: () => paymentCards(source, now, rules) },
    { module: RETURNS_MODULE, read: () => returnCards(source, now, rules) },
    { module: FULFILMENT_MODULE, read: () => deliveryCards(source, rules) },
  ].filter(r => held.includes(r.module));
  const results = await Promise.all(readers.map(async r => {
    try { return { cards: await r.read(), unavailable: [] as string[] }; }
    catch { return { cards: [], unavailable: [r.module] }; }
  }));
  return { cards: results.flatMap(r => r.cards), unavailable: results.flatMap(r => r.unavailable) };
}

/** Called on Dashboard open, user refresh, or a data-change/reconnect event; no timer or AI. */
export async function loadUnusualActivity(deps: Dependencies, staff: Staff, modules: readonly string[], now = new Date()): Promise<UnusualActivity> {
  const result = await compute(deps, staff, modules, now);
  if (!result.cards.length) return result;
  try {
    const dismissals = await deps.crms<{ alert_key: string; numbers: Numbers }[]>`
      select alert_key, numbers from crms.unusual_activity_dismissals where staff_id = ${staff.id}`;
    const dismissed = new Map(dismissals.map(d => [d.alert_key, d.numbers]));
    return { ...result, cards: result.cards.filter(c => !dismissed.has(c.key) || worsened(c.numbers, dismissed.get(c.key)!))
      .sort((a, b) => b.urgency - a.urgency || a.key.localeCompare(b.key)).slice(0, UNUSUAL_ACTIVITY_CARD_LIMIT) };
  } catch {
    return { cards: [], unavailable: [...new Set([...result.unavailable, ...visibleModules(staff, modules)])] };
  }
}

/** Snapshot is what the person saw, never arbitrary client numbers. A changed alert must be reviewed again. */
export async function dismissUnusualActivity(deps: Dependencies, staff: Staff, modules: readonly string[], key: string, numbers: Numbers, now = new Date()) {
  if (shopRole(staff.role) !== "manager") return { ok: false, reason: "Your Role can only view Unusual activity." } as const;
  try {
    const card = (await compute(deps, staff, modules, now)).cards.find(c => c.key === key);
    if (!card || Object.keys(numbers).length !== Object.keys(card.numbers).length ||
      Object.entries(card.numbers).some(([k, n]) => numbers[k] !== n))
      return { ok: false, reason: "This Unusual activity card changed or is no longer available. Refresh the Dashboard." } as const;
    await deps.crms`insert into crms.unusual_activity_dismissals (staff_id, alert_key, numbers)
      values (${staff.id}, ${key}, ${deps.crms.json(card.numbers)})
      on conflict (staff_id, alert_key) do update set numbers = (
        select jsonb_object_agg(n.key, greatest((n.value #>> '{}')::numeric,
          coalesce((crms.unusual_activity_dismissals.numbers ->> n.key)::numeric, 0)))
        from jsonb_each(excluded.numbers) as n(key, value)
      ), dismissed_at = now()`;
    return { ok: true } as const;
  } catch {
    return { ok: false, reason: "Could not dismiss this Unusual activity card. Please try again." } as const;
  }
}
