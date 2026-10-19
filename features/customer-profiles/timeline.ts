import type { CustomerOrder } from "./orders";

export type ActivityEntry = { orderId: number; at: Date } & (
  | { kind: "placed" }
  | { kind: "payment-proof" }
  | { kind: "feedback"; rating: number }
);

const KIND_ORDER: Record<ActivityEntry["kind"], number> = { feedback: 0, "payment-proof": 1, placed: 2 };

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

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime() || b.orderId - a.orderId || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}
