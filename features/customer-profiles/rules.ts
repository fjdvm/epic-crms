/** Order statuses whose totals count toward a Customer's Total spent. */
export const PAID_OR_FULFILLED = ["paid", "preparing", "dispatched", "delivered"];

export interface OrderAmounts {
  status: string;
  subtotalInCentavos: number;
  deliveryFeeInCentavos: number | null;
}

/** Total spent, in centavos: subtotal plus delivery fee of paid or fulfilled Orders. */
export function totalSpent(orders: OrderAmounts[]): number {
  return orders
    .filter((o) => PAID_OR_FULFILLED.includes(o.status))
    .reduce((sum, o) => sum + o.subtotalInCentavos + (o.deliveryFeeInCentavos ?? 0), 0);
}

/** A Customer is a person whose auth user has a verified email; everyone else is a Lead. */
export function isCustomer(authUser: { emailVerified: boolean } | null): boolean {
  return authUser?.emailVerified === true;
}

export type Stage = "new" | "first-order" | "repeat" | "at-risk" | "lost";

export const AT_RISK_AFTER_DAYS = 60;
export const LOST_AFTER_DAYS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A Customer whose last Order is at or before these instants is At risk / Lost. */
export function stageCutoffs(now: Date): { atRiskBefore: Date; lostBefore: Date } {
  return {
    atRiskBefore: new Date(now.getTime() - AT_RISK_AFTER_DAYS * DAY_MS),
    lostBefore: new Date(now.getTime() - LOST_AFTER_DAYS * DAY_MS),
  };
}

/**
 * Stage of a Customer. `orders` and `lastOrder` ignore cancelled Orders: a cancelled Order is
 * not an Order the Customer made for Stage purposes.
 */
export function stageOf(customer: { orders: number; lastOrder: Date | null }, now: Date): Stage {
  if (customer.orders === 0 || !customer.lastOrder) return "new";

  const { atRiskBefore, lostBefore } = stageCutoffs(now);
  if (customer.lastOrder <= lostBefore) return "lost";
  if (customer.lastOrder <= atRiskBefore) return "at-risk";

  return customer.orders === 1 ? "first-order" : "repeat";
}

export const STAGE_LABELS: Record<Stage, string> = {
  new: "New",
  "first-order": "First order",
  repeat: "Repeat",
  "at-risk": "At risk",
  lost: "Lost",
};

/** Payment status of an Order, derived from its status: there is no stored payment status. */
export function paymentStatusOf(status: string): "Paid" | "Unpaid" | "Cancelled" {
  if (status === "cancelled") return "Cancelled";

  return PAID_OR_FULFILLED.includes(status) ? "Paid" : "Unpaid";
}

const ORDER_LABELS: Record<string, string> = {
  pickup: "Pickup",
  delivery: "Delivery",
  gcash: "GCash",
  "cash-on-delivery": "Cash on delivery",
};

/** Display text for an Order status, fulfillment method or payment method. */
export function orderLabel(value: string): string {
  if (ORDER_LABELS[value]) return ORDER_LABELS[value];

  const spaced = value.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
