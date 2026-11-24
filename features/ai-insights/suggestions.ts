import {
  CUSTOMER_PROFILES_MODULE, FEEDBACK_MODULE, FULFILMENT_MODULE, ORDERS_MODULE, PAYMENTS_MODULE, RETURNS_MODULE,
} from "@/lib/portal/config";

import type { AreaInsights } from "./areas";
import type { CustomerInsights } from "./customers";
import { STOCK_WARN_DAYS, type OperationsInsights, type StockCover } from "./operations";
import type { OrderInsights } from "./orders";
import type { PaymentInsights } from "./payments";
import { LOYAL_ORDERS } from "./customers";

/**
 * A suggestion for a person to consider. Worked out in code from fixed rules (no AI decides anything), and it never
 * changes anything: the action only opens the screen where a person can act.
 */
export interface Suggestion {
  key: string;
  /** The Module whose data it comes from; shown only to people who hold it. */
  module: string;
  /** Whole numbers only: what the person saw, compared when they dismiss or accept. */
  numbers: Record<string, number>;
  text: string;
  action: { label: string; href: string; managerOnly?: boolean };
  urgency: number;
  /** One AI-written sentence on why it matters, when one was made and kept. */
  why?: string | null;
}

export interface SuggestionInputs {
  areas?: AreaInsights | null;
  orders?: OrderInsights | null;
  payments?: PaymentInsights | null;
  customers?: CustomerInsights | null;
  operations?: OperationsInsights | null;
  stock?: StockCover[] | null;
}

/** The fixed rules. AI features have fixed defaults (AGENTS.md); there is no setting for these. */
export const RULES = {
  areaMinOrders: 5,
  areaFailedShare: 0.15,
  areaRisingShare: 0.3,
  areaRisingMinPrevious: 3,
  loyalAtRisk: 3,
  slowProofHours: 6,
  slowProofMinOrders: 5,
  weekendSlowFactor: 2,
  unpaidOverThreeDays: 3,
  nearFreeDeliveryShare: 0.25,
  nearFreeDeliveryMinOrders: 10,
  bundleMinOrders: 5,
  bundleShare: 0.3,
  returnShare: 0.1,
  returnMinUnits: 3,
  lowRating: 3.5,
  courierMinDispatched: 5,
  courierFailedShare: 0.15,
} as const;

export const SUGGESTION_LIMIT = 6;
const pct = (share: number) => Math.round(share * 100);
const pesos = (centavos: number) => Math.round(centavos / 100);
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function buildSuggestions(inputs: SuggestionInputs): Suggestion[] {
  const out: Suggestion[] = [];
  const { areas, orders, payments, customers, operations, stock } = inputs;

  for (const area of areas?.areas ?? []) {
    if (area.orders < RULES.areaMinOrders) continue;
    const failed = area.failed / area.orders;
    if (failed >= RULES.areaFailedShare) {
      out.push({
        module: FULFILMENT_MODULE, key: `area-failed:${area.key}`, numbers: { orders: area.orders, failedPercent: pct(failed) },
        text: `${pct(failed)}% of the ${area.orders} Orders to ${area.name} had a failed delivery. Check the addresses and the courier used there.`,
        action: { label: "Open Fulfilment", href: "/fulfilment" }, urgency: 2 + failed,
      });
    }
    if (area.previousOrders >= RULES.areaRisingMinPrevious) {
      const change = (area.orders - area.previousOrders) / area.previousOrders;
      if (change >= RULES.areaRisingShare) {
        out.push({
          module: ORDERS_MODULE, key: `area-rising:${area.key}`, numbers: { orders: area.orders, previousOrders: area.previousOrders, changePercent: pct(change) },
          text: `Orders to ${area.name} rose ${pct(change)}%, from ${area.previousOrders} to ${area.orders}. Make sure deliveries there can keep up.`,
          action: { label: "Open Orders", href: "/orders" }, urgency: 1 + Math.min(change, 1),
        });
      }
    }
  }

  if (customers && customers.loyalAtRisk >= RULES.loyalAtRisk) {
    out.push({
      module: CUSTOMER_PROFILES_MODULE, key: "loyal-at-risk", numbers: { customers: customers.loyalAtRisk },
      text: `${customers.loyalAtRisk} Customers who bought ${LOYAL_ORDERS} or more times have not ordered in 60 days. Consider a win-back offer.`,
      action: { label: "See At risk Customers", href: "/customer-profiles?stage=at-risk" }, urgency: 2 + customers.loyalAtRisk / 20,
    });
  }

  if (payments) {
    const { verify, unpaid, nearFreeDelivery } = payments;
    const weekday = verify.weekdayMedianHours, weekend = verify.weekendMedianHours;
    if (verify.orders >= RULES.slowProofMinOrders && weekend !== null && weekday !== null && weekday > 0
      && weekend >= weekday * RULES.weekendSlowFactor && weekend >= RULES.slowProofHours / 2) {
      out.push({
        module: PAYMENTS_MODULE, key: "slow-proofs-weekend", numbers: { weekendHours: Math.round(weekend), weekdayHours: Math.round(weekday) },
        text: `Payment proofs sent on weekends wait ${Math.round(weekend)} hours to be checked, against ${Math.round(weekday)} on weekdays. Consider who checks payments on weekends.`,
        action: { label: "Open Payments", href: "/payments" }, urgency: 2 + weekend / 24,
      });
    } else if (verify.orders >= RULES.slowProofMinOrders && verify.medianHours !== null && verify.medianHours >= RULES.slowProofHours) {
      out.push({
        module: PAYMENTS_MODULE, key: "slow-proofs", numbers: { hours: Math.round(verify.medianHours), orders: verify.orders },
        text: `Payment proofs wait ${Math.round(verify.medianHours)} hours to be checked, half of the time. Customers wait that long to hear their Order is paid.`,
        action: { label: "Open Payments", href: "/payments" }, urgency: 2 + verify.medianHours / 24,
      });
    }
    const old = unpaid.find((b) => b.key === "over-3-days");
    if (old && old.orders >= RULES.unpaidOverThreeDays) {
      out.push({
        module: PAYMENTS_MODULE, key: "unpaid-over-3-days", numbers: { orders: old.orders, pesos: pesos(old.value) },
        text: `${old.orders} Orders worth ₱${pesos(old.value).toLocaleString("en-PH")} have waited over 3 days for payment. Remind the Customers, or cancel the ones that will not pay.`,
        action: { label: "Open Payments", href: "/payments" }, urgency: 3 + old.orders / 10,
      });
    }
    if (nearFreeDelivery.eligible >= RULES.nearFreeDeliveryMinOrders) {
      const share = nearFreeDelivery.orders / nearFreeDelivery.eligible;
      if (share >= RULES.nearFreeDeliveryShare) {
        out.push({
          module: PAYMENTS_MODULE, key: "near-free-delivery", numbers: { percent: pct(share), orders: nearFreeDelivery.orders },
          text: `${pct(share)}% of the Orders that paid a Delivery fee were within 20% of free delivery. Consider whether the free-delivery threshold is right.`,
          action: { label: "Open Commerce Settings", href: "/management/commerce-settings", managerOnly: true }, urgency: 1 + share,
        });
      }
    }
  }

  const pair = orders?.pairs[0];
  if (pair && pair.orders >= RULES.bundleMinOrders && pair.ordersOfLessPopular > 0 && pair.orders / pair.ordersOfLessPopular >= RULES.bundleShare) {
    out.push({
      module: ORDERS_MODULE, key: `bundle:${slug(pair.a)}:${slug(pair.b)}`, numbers: { orders: pair.orders },
      text: `${pair.a} and ${pair.b} were bought together in ${pair.orders} Orders. Consider offering them as a bundle.`,
      action: { label: "Open Products & Stocks", href: "/orders/stock" }, urgency: 1 + pair.orders / 50,
    });
  }

  for (const item of (stock ?? []).slice(0, 3)) {
    out.push({
      module: ORDERS_MODULE, key: `stock:${slug(item.name)}`, numbers: { daysShort: STOCK_WARN_DAYS - item.daysLeft },
      text: `${item.name} may run out in about ${item.daysLeft} days: ${item.available} left, selling about ${item.soldPerDay} a day. Let the factory know.`,
      action: { label: "Open Products & Stocks", href: "/orders/stock" }, urgency: 3 + (STOCK_WARN_DAYS - item.daysLeft) / STOCK_WARN_DAYS,
    });
  }

  for (const product of operations?.returns.products ?? []) {
    if (product.returned < RULES.returnMinUnits || product.sold === 0) continue;
    const share = product.returned / product.sold;
    if (share < RULES.returnShare) continue;
    out.push({
      module: RETURNS_MODULE, key: `returns:${slug(product.product)}`, numbers: { returned: product.returned, sold: product.sold, percent: pct(share) },
      text: `${product.returned} of the ${product.sold} ${product.product} sold came back (${pct(share)}%). Check the batch and the packing.`,
      action: { label: "Open Returns", href: "/returns" }, urgency: 2 + share,
    });
  }

  for (const product of operations?.feedback.lowestProducts ?? []) {
    if (product.average > RULES.lowRating) continue;
    out.push({
      module: FEEDBACK_MODULE, key: `low-rating:${slug(product.product)}`, numbers: { ratings: product.ratings, tenthsBelowFive: Math.round((5 - product.average) * 10) },
      text: `${product.product} averages ${product.average} stars from ${product.ratings} ratings. Read what Customers say about it.`,
      action: { label: "Open Feedback", href: "/feedback" }, urgency: 1 + (5 - product.average) / 5,
    });
  }

  for (const courier of operations?.fulfilment.couriers ?? []) {
    if (courier.dispatched < RULES.courierMinDispatched) continue;
    const share = courier.failed / courier.dispatched;
    if (share < RULES.courierFailedShare) continue;
    out.push({
      module: FULFILMENT_MODULE, key: `courier:${slug(courier.courier)}`, numbers: { dispatched: courier.dispatched, failed: courier.failed },
      text: `${courier.failed} of the ${courier.dispatched} Orders sent with ${courier.courier} had a failed delivery (${pct(share)}%). Consider another courier for some areas.`,
      action: { label: "Open Fulfilment", href: "/fulfilment" }, urgency: 2 + share,
    });
  }

  return out.sort((a, b) => b.urgency - a.urgency || a.key.localeCompare(b.key));
}

/** A larger number is worse; only a worse one brings back a dismissed or accepted suggestion. */
export function worsened(current: Record<string, number>, seen: Record<string, number>): boolean {
  return Object.entries(current).some(([k, v]) => v > (seen[k] ?? v));
}
