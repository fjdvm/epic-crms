import { FULFILMENT_MODULE, ORDERS_MODULE, PAYMENTS_MODULE, RETURNS_MODULE, TICKETS_MODULE } from "@/lib/portal/config";

/**
 * AI insights: what changed in the period, where, and what to look at next. Every figure, priority and confidence
 * here is worked out in code from fixed rules (AGENTS.md: AI features have fixed defaults). The AI only words the
 * "why and what to do" afterwards, and nothing here changes the shop: each action only opens a screen.
 */

/** The Modules whose cards the page can show; each card shows only to people who hold its Module. */
export const AI_INSIGHTS_MODULES = [ORDERS_MODULE, PAYMENTS_MODULE, FULFILMENT_MODULE, RETURNS_MODULE, TICKETS_MODULE];

export const PERIOD_DAYS = [7, 30] as const;
export type PeriodDays = (typeof PERIOD_DAYS)[number];

/** Below this many Orders in the period there are no insights at all: "Not enough data", never a guess. */
export const MIN_ORDERS = 30;

/** The fixed rules. */
export const RULES = {
  /** A delivery is late when it arrives more than this many hours after it was paid (or placed, for Cash on Delivery). */
  lateHours: 48,
  /** Orders that will be cancelled by their payment deadline within this many hours. */
  expiringHours: 24,
  /** A Ticket is at risk once this share of its first-reply target is used up. */
  slaUsedShare: 0.75,
  /** A product's return rate must be at least this many times the shop's, and at least the floor. */
  returnFactor: 2,
  returnFloorShare: 0.05,
  returnMinUnits: 3,
  /** Late or failed deliveries: an area or courier needs this many deliveries, this rate, and this rise in points. */
  deliveryMinOrders: 4,
  deliveryShare: 0.15,
  deliveryRisePoints: 10,
  /** Ticket themes: at least this many Tickets in one theme. */
  themeMinTickets: 3,
  /** Confidence by sample size: High from this many, Medium from that many, Low below. */
  sampleHigh: 30,
  sampleMedium: 10,
} as const;

export type Category = "stock" | "payments" | "support" | "returns" | "delivery";
export type Priority = "high" | "watch" | "info";
export type Confidence = "high" | "medium" | "low";
export type RecordType = "order" | "ticket" | "return";

export const CATEGORY_LABELS: Record<Category, string> = {
  stock: "Stock", payments: "Payments", support: "Support", returns: "Returns", delivery: "Delivery",
};
export const PRIORITY_LABELS: Record<Priority, string> = { high: "High", watch: "Watch", info: "Info" };
export const CONFIDENCE_LABELS: Record<Confidence, string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

export interface EvidenceRef { type: RecordType; id: number }

export interface Insight {
  /** Stable while the same thing is true, so "Dismiss for me" sticks until it gets worse. */
  key: string;
  category: Category;
  /** The Module whose data it comes from; only people who hold it see it. */
  module: string;
  priority: Priority;
  confidence: Confidence;
  confidenceReason: string;
  headline: string;
  basedOn: string;
  /** "How the AI got here": the steps the rule took, written in code. */
  steps: string[];
  /** Whole numbers that grow when things get worse; what a dismissal is compared with. */
  numbers: Record<string, number>;
  /** The records behind it, newest or most urgent first. */
  records: EvidenceRef[];
  action: { label: string; href: string };
  /** The rule's own suggested next step, shown when the AI wrote nothing. */
  nextStep: string;
  /** "Why and what to do", AI-written from the facts above and checked to quote only their numbers. */
  ai?: string | null;
}

/** A count (or a 0–1 rate) for one map area or city, now and in the period before. */
export interface PlaceFigures {
  key: string;
  name: string;
  orders: number;
  previousOrders: number;
  /** Delivery Orders that went out with a courier, and how many of them were late or failed. */
  wentOut: number;
  lateOrFailed: number;
  previousWentOut: number;
  previousLateOrFailed: number;
  /** Orders with a Return. */
  returned: number;
  /** Tickets about these Orders. */
  complaints: number;
  /** Delivery Orders, and how many reached free delivery. */
  deliveries: number;
  freeDelivery: number;
}
export interface CityFigures extends PlaceFigures { province: string }
export interface AreaFigures extends PlaceFigures { cities: CityFigures[] }

export interface CourierFigures {
  courier: string;
  wentOut: number;
  lateOrFailed: number;
  previousWentOut: number;
  previousLateOrFailed: number;
  /** Late or failed Orders in the period, newest first. */
  orderIds: number[];
}
export interface StockFigures { key: string; name: string; available: number; soldPerDay: number; daysLeft: number; unitsSold: number; orderIds: number[] }
export interface ExpiringFigures { orders: number; value: number; orderIds: number[]; soonestHours: number | null }
export interface SlaFigures { atRisk: number; breaching: number; ticketIds: number[]; open: number }
export interface ReturnProduct { product: string; sold: number; returned: number; returnIds: number[] }
export interface ThemeFigures { label: string; ticketIds: number[]; product: string | null; productTickets: number; area: string | null; areaTickets: number }

/** Everything the rules read, computed in SQL and code. No Customer is in here: IDs, names of places, products and couriers only. */
export interface InsightFacts {
  days: PeriodDays;
  orders: number;
  previousOrders: number;
  wentOut: number;
  lateOrFailed: number;
  returnsRequested: number;
  returnedOrders: number;
  areas: AreaFigures[];
  /** Orders whose address the map cannot place. */
  unmapped: number;
  /** Delivery Orders by city for the period, with the late or failed ones, newest first. */
  lateOrFailedByCity: { key: string; orderIds: number[] }[];
  couriers: CourierFigures[];
  stock: StockFigures[] | null;
  expiring: ExpiringFigures | null;
  sla: SlaFigures | null;
  returns: { sold: number; returned: number; products: ReturnProduct[] } | null;
  themes: ThemeFigures[] | null;
}

export interface Stat { value: number | null; note: string; tone?: "up" | "down" | "warn" | null }
export interface Stats { orders: Stat; lateOrFailed: Stat; returns: Stat; openTickets: Stat; stockWatch: Stat }

const pct = (share: number) => Math.round(share * 100);
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const periodWords = (days: PeriodDays) => (days === 7 ? "this week" : "in the last 30 days");
const before = (days: PeriodDays) => (days === 7 ? "the week before" : "the 30 days before");
const MAX_RECORDS = 10;
const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Confidence from how many things the figure rests on: a small sample is always Low. */
export function confidenceFor(sample: number, ceiling: Confidence = "high"): { confidence: Confidence; reason: string } {
  const level: Confidence = sample >= RULES.sampleHigh ? "high" : sample >= RULES.sampleMedium ? "medium" : "low";
  const order: Confidence[] = ["low", "medium", "high"];
  const confidence = order[Math.min(order.indexOf(level), order.indexOf(ceiling))];
  const reason = confidence === "low"
    ? `Low because it rests on only ${sample}; a few more or fewer would change it.`
    : confidence === "medium"
      ? `Medium because it rests on ${sample}${ceiling === "medium" ? ", and grouping by what Customers wrote is not exact" : ""}.`
      : `High because it rests on ${sample}, enough for the pattern to hold.`;
  return { confidence, reason };
}

/** Whether there is enough to say anything. */
export const enoughData = (facts: Pick<InsightFacts, "orders">) => facts.orders >= MIN_ORDERS;

export function buildInsights(facts: InsightFacts): Insight[] {
  if (!enoughData(facts)) return [];
  const out: Insight[] = [];
  const when = periodWords(facts.days);

  for (const item of (facts.stock ?? []).slice(0, 3)) {
    const { confidence, reason } = confidenceFor(item.unitsSold);
    out.push({
      key: `stock:${item.key}`, category: "stock", module: ORDERS_MODULE,
      priority: item.daysLeft <= 2 ? "high" : "watch", confidence, confidenceReason: reason,
      headline: `${item.name} may run out in about ${plural(item.daysLeft, "day")}`,
      basedOn: `${item.available} left, selling about ${item.soldPerDay} a day over the last 14 days`,
      steps: [
        `Counted the units of ${item.name} sold in the last 14 days: ${item.unitsSold}.`,
        `That is about ${item.soldPerDay} a day.`,
        `The IMS stock count shows ${item.available} left, which lasts about ${plural(item.daysLeft, "day")} at that pace.`,
      ],
      numbers: { daysShort: 5 - item.daysLeft },
      records: item.orderIds.slice(0, MAX_RECORDS).map((id) => ({ type: "order", id })),
      action: { label: "Open Stock", href: "/orders/stock" },
      nextStep: "Ask the Kitchen whether a batch is planned, and check the count in Stock.",
    });
  }

  const expiring = facts.expiring;
  if (expiring && expiring.orders > 0) {
    out.push({
      key: "payments:expiring", category: "payments", module: PAYMENTS_MODULE,
      priority: expiring.orders >= 3 ? "high" : "watch", confidence: "high", confidenceReason: "High because it comes from each Order's saved payment deadline.",
      headline: `${plural(expiring.orders, "unpaid Order")} will auto-cancel within ${RULES.expiringHours} hours`,
      basedOn: `GCash, Maya or bank transfer Orders with no proof waiting to be checked, worth ₱${Math.round(expiring.value / 100).toLocaleString("en-PH")}`,
      steps: [
        "Listed the online-payment Orders that are still unpaid.",
        "Left out the ones with a proof waiting to be checked, since that pauses the deadline.",
        `Kept the ${plural(expiring.orders, "Order")} whose payment deadline falls within ${RULES.expiringHours} hours.`,
      ],
      numbers: { orders: expiring.orders },
      records: expiring.orderIds.slice(0, MAX_RECORDS).map((id) => ({ type: "order", id })),
      action: { label: "Open Payments", href: "/payments" },
      nextStep: "Message these Customers before the deadline, or let the Orders cancel if they will not pay.",
    });
  }

  for (const theme of (facts.themes ?? []).filter((t) => t.ticketIds.length >= RULES.themeMinTickets).slice(0, 2)) {
    const n = theme.ticketIds.length;
    const { confidence, reason } = confidenceFor(n, "medium");
    const where = [
      theme.product && theme.productTickets >= 2 ? `${theme.productTickets} about ${theme.product}` : null,
      theme.area && theme.areaTickets >= 2 ? `${theme.areaTickets} from ${theme.area}` : null,
    ].filter(Boolean);
    out.push({
      key: `support:theme:${slug(theme.label)}`, category: "support", module: TICKETS_MODULE,
      priority: n >= 5 ? "high" : "watch", confidence, confidenceReason: reason,
      headline: `${plural(n, "Ticket")} ${when} mention ${theme.label.charAt(0).toLowerCase()}${theme.label.slice(1)}`,
      basedOn: where.length ? `${plural(n, "Ticket")}: ${where.join(", ")}` : `${plural(n, "Ticket")} with the same complaint`,
      steps: [
        `Read the first Customer message of each Ticket opened ${when}.`,
        `Grouped the ones about the same problem: ${plural(n, "Ticket")} about "${theme.label}".`,
        ...(where.length ? [`Looked up their Orders: ${where.join(", ")}.`] : []),
      ],
      numbers: { tickets: n },
      records: theme.ticketIds.slice(0, MAX_RECORDS).map((id) => ({ type: "ticket", id })),
      action: { label: "Open Tickets", href: "/tickets" },
      nextStep: theme.product
        ? `Check recent ${theme.product} batches and the packing, and reply to these Tickets with one clear answer.`
        : "Read these Tickets together and reply with one clear answer.",
    });
  }

  const sla = facts.sla;
  if (sla && sla.atRisk > 0) {
    out.push({
      key: "support:sla", category: "support", module: TICKETS_MODULE,
      priority: sla.breaching > 0 ? "high" : "watch", confidence: "high", confidenceReason: "High because it comes from each Ticket's own service-level clock.",
      headline: `${plural(sla.atRisk, "Ticket")} may miss the 24-hour first-reply target`,
      basedOn: `${pct(RULES.slaUsedShare)}% or more of the target used${sla.breaching ? `, ${sla.breaching} with under an hour left` : ""}; the clock stops while On hold`,
      steps: [
        "Listed open Tickets that have no reply from the team yet.",
        "Ran each one's service-level clock, which stops while the Ticket is On hold.",
        `Kept the ${plural(sla.atRisk, "Ticket")} with ${pct(RULES.slaUsedShare)}% or more of the target used.`,
      ],
      numbers: { tickets: sla.atRisk },
      records: sla.ticketIds.slice(0, MAX_RECORDS).map((id) => ({ type: "ticket", id })),
      action: { label: "Open Tickets", href: "/tickets" },
      nextStep: "Claim the oldest of these first, or assign them to a teammate who is free.",
    });
  }

  const returns = facts.returns;
  if (returns && returns.sold > 0) {
    const average = returns.returned / returns.sold;
    const worst = returns.products
      .filter((p) => p.sold > 0 && p.returned >= RULES.returnMinUnits)
      .map((p) => ({ ...p, share: p.returned / p.sold }))
      .filter((p) => p.share >= RULES.returnFloorShare && p.share >= average * RULES.returnFactor)
      .sort((a, b) => b.share - a.share || b.returned - a.returned)
      .slice(0, 2);
    for (const p of worst) {
      const { confidence, reason } = confidenceFor(p.sold);
      const times = average > 0 ? Math.round(p.share / average) : null;
      out.push({
        key: `returns:${slug(p.product)}`, category: "returns", module: RETURNS_MODULE,
        priority: times !== null && times >= 3 ? "high" : "watch", confidence, confidenceReason: reason,
        headline: `${p.product} has a high return rate: ${pct(p.share)}%`,
        basedOn: `${p.returned} of ${p.sold} sold came back; the shop average is ${pct(average)}%`,
        steps: [
          `Counted the units sold and returned for each product ${when}.`,
          `The shop as a whole had ${pct(average)}% returned.`,
          `${p.product} had ${p.returned} of ${p.sold} returned (${pct(p.share)}%)${times ? `, about ${times} times the shop average` : ""}.`,
        ],
        numbers: { percent: pct(p.share), returned: p.returned },
        records: p.returnIds.slice(0, MAX_RECORDS).map((id) => ({ type: "return", id })),
        action: { label: "Open Returns", href: "/returns" },
        nextStep: `Read the return reasons for ${p.product} and check the batch and the packing.`,
      });
    }
  }

  const risen = (now: number, nowOut: number, then: number, thenOut: number) => {
    if (nowOut < RULES.deliveryMinOrders) return false;
    const share = now / nowOut;
    const previous = thenOut > 0 ? then / thenOut : 0;
    return share >= RULES.deliveryShare && pct(share) - pct(previous) >= RULES.deliveryRisePoints;
  };
  const cities = facts.areas.flatMap((a) => a.cities)
    .filter((c) => risen(c.lateOrFailed, c.wentOut, c.previousLateOrFailed, c.previousWentOut))
    .sort((a, b) => b.lateOrFailed / b.wentOut - a.lateOrFailed / a.wentOut || b.lateOrFailed - a.lateOrFailed)
    .slice(0, 3);
  if (cities.length) {
    const late = cities.reduce((s, c) => s + c.lateOrFailed, 0), out_ = cities.reduce((s, c) => s + c.wentOut, 0);
    const prevLate = cities.reduce((s, c) => s + c.previousLateOrFailed, 0), prevOut = cities.reduce((s, c) => s + c.previousWentOut, 0);
    const { confidence, reason } = confidenceFor(out_);
    const ids = new Map(facts.lateOrFailedByCity.map((c) => [c.key, c.orderIds]));
    out.push({
      key: `delivery:areas:${cities.map((c) => slug(c.key)).sort().join("+")}`, category: "delivery", module: FULFILMENT_MODULE,
      priority: late / out_ >= 0.3 ? "high" : "watch", confidence, confidenceReason: reason,
      headline: `Late and failed deliveries are up in ${list(cities.map((c) => c.name))}`,
      basedOn: `${late} of ${out_} deliveries late or failed (${pct(late / out_)}%), against ${prevOut ? `${pct(prevLate / prevOut)}%` : "none"} ${before(facts.days)}`,
      steps: [
        `Counted deliveries by city ${when}: late (more than ${RULES.lateHours} hours after payment) or failed.`,
        `Compared each city with ${before(facts.days)}.`,
        `Kept the cities with ${RULES.deliveryMinOrders} or more deliveries where the share rose ${RULES.deliveryRisePoints} points or more: ${list(cities.map((c) => `${c.name} ${c.lateOrFailed} of ${c.wentOut}`))}.`,
      ],
      numbers: { percent: pct(late / out_), orders: late },
      records: cities.flatMap((c) => ids.get(c.key) ?? []).slice(0, MAX_RECORDS).map((id) => ({ type: "order", id })),
      action: { label: "Open Fulfilment", href: "/fulfilment" },
      nextStep: "Check the addresses and the courier used for these Orders, and ask the riders what went wrong.",
    });
  }

  for (const c of facts.couriers.filter((c) => c.courier !== "Not recorded" && risen(c.lateOrFailed, c.wentOut, c.previousLateOrFailed, c.previousWentOut)).slice(0, 2)) {
    const { confidence, reason } = confidenceFor(c.wentOut);
    out.push({
      key: `delivery:courier:${slug(c.courier)}`, category: "delivery", module: FULFILMENT_MODULE,
      priority: c.lateOrFailed / c.wentOut >= 0.3 ? "high" : "watch", confidence, confidenceReason: reason,
      headline: `More ${c.courier} deliveries are late or failing`,
      basedOn: `${c.lateOrFailed} of ${c.wentOut} (${pct(c.lateOrFailed / c.wentOut)}%), against ${c.previousWentOut ? `${pct(c.previousLateOrFailed / c.previousWentOut)}%` : "none"} ${before(facts.days)}`,
      steps: [
        `Counted the Orders sent with ${c.courier} ${when}: ${c.wentOut}.`,
        `${c.lateOrFailed} were late (more than ${RULES.lateHours} hours after payment) or failed.`,
        `Compared with ${before(facts.days)}: ${c.previousLateOrFailed} of ${c.previousWentOut}.`,
      ],
      numbers: { percent: pct(c.lateOrFailed / c.wentOut), orders: c.lateOrFailed },
      records: c.orderIds.slice(0, MAX_RECORDS).map((id) => ({ type: "order", id })),
      action: { label: "Open Fulfilment", href: "/fulfilment" },
      nextStep: `Look at where the ${c.courier} problems happen, and consider another courier for those areas.`,
    });
  }

  const rank: Record<Priority, number> = { high: 0, watch: 1, info: 2 };
  return out.sort((a, b) => rank[a.priority] - rank[b.priority] || a.key.localeCompare(b.key));
}

/** The five figures at the top of the page. Null values are shown as a dash. */
export function emptyStats(): Stats {
  const none = () => ({ value: null, note: "No data yet" });
  return { orders: none(), lateOrFailed: none(), returns: none(), openTickets: none(), stockWatch: none() };
}

export function buildStats(facts: InsightFacts): Stats {
  const change = facts.previousOrders > 0 ? Math.round(((facts.orders - facts.previousOrders) / facts.previousOrders) * 100) : null;
  const firstStock = facts.stock?.[0];
  return {
    orders: {
      value: facts.orders,
      note: change === null ? `None ${before(facts.days)}` : `${change >= 0 ? "+" : ""}${change}% vs ${before(facts.days)}`,
      tone: change === null || change === 0 ? null : change > 0 ? "up" : "down",
    },
    lateOrFailed: {
      value: facts.lateOrFailed,
      note: facts.wentOut ? `${pct(facts.lateOrFailed / facts.wentOut)}% of ${facts.wentOut} deliveries` : "No deliveries yet",
      tone: facts.wentOut && facts.lateOrFailed / facts.wentOut >= RULES.deliveryShare ? "warn" : null,
    },
    returns: {
      value: facts.returnsRequested,
      note: facts.orders ? `${pct(facts.returnedOrders / facts.orders)}% of Orders` : "",
    },
    openTickets: facts.sla
      ? { value: facts.sla.open, note: facts.sla.atRisk ? `${facts.sla.atRisk} near the 24h target` : "None near the 24h target", tone: facts.sla.atRisk ? "warn" : null }
      : { value: null, note: "Not in your Modules" },
    stockWatch: facts.stock
      ? { value: facts.stock.length, note: firstStock ? `${firstStock.name} in ~${plural(firstStock.daysLeft, "day")}` : "Nothing running low", tone: facts.stock.length ? "warn" : null }
      : { value: null, note: "Not available" },
  };
}

/** A larger number is worse; only a worse one brings back a dismissed insight. */
export function worsened(current: Record<string, number>, seen: Record<string, number>): boolean {
  return Object.entries(current).some(([k, v]) => v > (seen[k] ?? v));
}
