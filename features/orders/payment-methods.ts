/** The ways a Customer can pay. GCash, Maya and bank transfer are all manual: a reference number and an optional screenshot. */
export const PREPAID_METHODS = ["gcash", "maya", "bank-transfer"] as const;
export type PrepaidMethod = (typeof PREPAID_METHODS)[number];
export type PaymentMethod = PrepaidMethod | "cash-on-delivery";

export const isPrepaid = (method: string): method is PrepaidMethod => (PREPAID_METHODS as readonly string[]).includes(method);

/** After this many rejected proofs, only a Manager can approve the Order. */
export const MANAGER_AFTER_REJECTIONS = 3;
