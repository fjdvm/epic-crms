import { FULFILMENT_MODULE, ORDERS_MODULE, PAYMENTS_MODULE } from "@/lib/portal/config";

/**
 * The nine Status emails the storefront sends (#575). CREOMS never sends one; it only shows "Email not sent"
 * and asks the storefront to resend under the same stable id. The owning Module decides who sees the Resend.
 */
export const STATUS_EMAILS = {
  confirmation: { label: "confirmation", module: ORDERS_MODULE },
  // The confirmation emails the storefront records today, by fulfilment and payment kind.
  "delivery-confirmed": { label: "delivery confirmation", module: ORDERS_MODULE },
  "online-delivery-confirmed": { label: "delivery confirmation", module: ORDERS_MODULE },
  "pickup-confirmed": { label: "pickup confirmation", module: ORDERS_MODULE },
  "online-pickup-confirmed": { label: "pickup confirmation", module: ORDERS_MODULE },
  "payment-verified": { label: "payment verified", module: PAYMENTS_MODULE },
  "payment-rejected": { label: "payment rejected", module: PAYMENTS_MODULE },
  "payment-expired": { label: "payment expired", module: PAYMENTS_MODULE },
  "manager-review-started": { label: "Manager review started", module: PAYMENTS_MODULE },
  preparing: { label: "Preparing", module: FULFILMENT_MODULE },
  dispatched: { label: "Out for delivery", module: FULFILMENT_MODULE },
  "ready-for-pickup": { label: "Ready for pickup", module: FULFILMENT_MODULE },
  completed: { label: "Delivered or Picked up", module: FULFILMENT_MODULE },
} as const;

export type StatusEmailKind = keyof typeof STATUS_EMAILS;

export const isStatusEmailKind = (kind: unknown): kind is StatusEmailKind =>
  typeof kind === "string" && Object.hasOwn(STATUS_EMAILS, kind);

/** One occurrence of an email is one event: the second rejection is a different occurrence from the first. */
export const MAX_OCCURRENCE_LENGTH = 40;
export const isOccurrence = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(value));

export interface FailedEmail { kind: StatusEmailKind; occurrence: string | null; reason: string }

export const emailTitle = (kind: StatusEmailKind) => `${STATUS_EMAILS[kind].label[0].toUpperCase()}${STATUS_EMAILS[kind].label.slice(1)} email`;
