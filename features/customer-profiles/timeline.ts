import type { CustomerOrder } from "./orders";

export interface ActivityEntry {
  kind: "placed" | "payment-proof" | "feedback";
  orderId: number;
  at: Date;
  /** Only for feedback. */
  rating?: number;
}

/**
 * A Customer's activity, newest first. The store keeps no history of Order status changes, so
 * the dated steps it does record stand in for them: payment proof submitted, and feedback.
 */
export function activityOf(orders: CustomerOrder[]): ActivityEntry[] {
  const entries = orders.flatMap((o): ActivityEntry[] => [
    { kind: "placed", orderId: o.id, at: o.createdAt },
    ...(o.paymentProof?.submittedAt
      ? [{ kind: "payment-proof" as const, orderId: o.id, at: o.paymentProof.submittedAt }]
      : []),
    ...(o.feedback ? [{ kind: "feedback" as const, orderId: o.id, at: o.feedback.createdAt, rating: o.feedback.rating }] : []),
  ]);

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime() || b.orderId - a.orderId);
}
