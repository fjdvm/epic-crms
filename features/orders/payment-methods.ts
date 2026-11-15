/** The ways a Customer can pay. GCash, Maya and bank transfer are all manual: a reference number and an optional screenshot. */
export const PREPAID_METHODS = ["gcash", "maya", "bank-transfer"] as const;
export type PrepaidMethod = (typeof PREPAID_METHODS)[number];
export type PaymentMethod = PrepaidMethod | "cash-on-delivery";

export const isPrepaid = (method: string): method is PrepaidMethod => (PREPAID_METHODS as readonly string[]).includes(method);

/** After this many rejected proofs, only a Manager can approve the Order. */
export const MANAGER_AFTER_REJECTIONS = 3;

const REFUND_LABELS: Record<PrepaidMethod, string> = { gcash: "GCash", maya: "Maya", "bank-transfer": "bank transfer" };

/** A refund goes back the way the Customer paid; Cash on Delivery has nothing to send back. */
export function refundDestination(method: string): string | null {
  return isPrepaid(method) ? REFUND_LABELS[method] : null;
}
