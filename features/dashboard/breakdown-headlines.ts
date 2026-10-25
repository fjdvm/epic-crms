import type { BestSellers, MonthlyBuyers, PaymentAndReceiving } from "./breakdowns";

/** A trend needs at least this many finished months in a row to be worth a sentence. */
const MIN_RUN = 3;

export const NEUTRAL_BEST_SELLERS_TITLE = "Best-selling products";
export const NEUTRAL_BUYERS_TITLE = "New vs returning Buyers";
export const NEUTRAL_PAYMENT_TITLE = "How customers pay";

const monthName = (label: string) =>
  new Date(`${label}-01T00:00:00Z`).toLocaleString("en-PH", { month: "long", timeZone: "UTC" });

export const METHOD_LABELS: Record<string, string> = {
  gcash: "GCash",
  "cash-on-delivery": "Cash on Delivery",
  pickup: "Pickup",
  delivery: "Delivery",
};

export function bestSellersHeadline(products: BestSellers["products"]): string {
  const top = products[0];
  if (!top || top.share === null) return NEUTRAL_BEST_SELLERS_TITLE;

  return `${top.productName} leads with ${Math.round(top.share * 100)}% of Sales`;
}

/** The unfinished month is left out of the judgement. */
export function buyersHeadline(months: MonthlyBuyers["months"]): string {
  const finished = months.filter((m) => !m.soFar);
  let start = finished.length - 1;
  while (start > 0 && finished[start].returning > finished[start - 1].returning) start--;

  return finished.length - start >= MIN_RUN
    ? `Returning Buyers have grown every month since ${monthName(finished[start].label)}`
    : NEUTRAL_BUYERS_TITLE;
}

/** Only a method with more than half of the Orders is called the usual one. */
export function paymentHeadline(payment: PaymentAndReceiving["payment"]): string {
  const total = payment.reduce((sum, p) => sum + p.orders, 0);
  const top = payment.find((p) => p.orders * 2 > total);
  if (!top) return NEUTRAL_PAYMENT_TITLE;

  return top.method === "gcash" ? "Most Orders are paid by GCash" : `Most Orders are ${METHOD_LABELS[top.method] ?? top.method}`;
}
