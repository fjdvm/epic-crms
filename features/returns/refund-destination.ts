import { createHash } from "node:crypto";

import { PREPAID_METHODS, type PrepaidMethod } from "@/features/orders/payment-methods";

/** Where a refund goes, as the Customer confirmed it on their Return request. */
export interface RefundDestination {
  method: PrepaidMethod;
  accountName: string;
  accountNumber: string;
  /** Only for a bank transfer. */
  bankName: string | null;
}

/** What screens may hold: the same destination with the number masked. The full number never travels to a browser by default. */
export interface MaskedRefundDestination {
  method: PrepaidMethod;
  accountName: string;
  maskedNumber: string;
  bankName: string | null;
}

/** "•••••••4567": the last four digits only, so Staff can recognise it without the whole number being on show. */
export function maskAccountNumber(number: string): string {
  const compact = number.replace(/[\s-]/g, "");
  if (compact.length <= 4) return "•".repeat(Math.max(compact.length, 4));

  return `${"•".repeat(compact.length - 4)}${compact.slice(-4)}`;
}

export const maskDestination = (destination: RefundDestination): MaskedRefundDestination => ({
  method: destination.method, accountName: destination.accountName, maskedNumber: maskAccountNumber(destination.accountNumber), bankName: destination.bankName,
});

/** A short label for audit lines and dialogs, always masked: "GCash •••••••4567". */
export const describeMasked = (destination: MaskedRefundDestination): string =>
  `${destination.method === "bank-transfer" ? (destination.bankName ?? "Bank transfer") : destination.method === "gcash" ? "GCash" : "Maya"} ${destination.maskedNumber}`;

export type DestinationInput = { method: string; accountName: string; accountNumber: string; bankName?: string | null };
export type DestinationCheck = { ok: true; destination: RefundDestination } | { ok: false; reason: string };

/** The same shape the Customer is held to on the storefront: (lib/returns/refund-destination.ts there). */
export function checkDestination(input: DestinationInput): DestinationCheck {
  if (!input || typeof input.method !== "string" || !(PREPAID_METHODS as readonly string[]).includes(input.method)) return { ok: false, reason: "Choose GCash, Maya or bank transfer." };
  const method = input.method as PrepaidMethod;
  const accountName = typeof input.accountName === "string" ? input.accountName.trim().replace(/\s+/g, " ") : "";
  if (!accountName || accountName.length > 100 || !/^[\p{L}\p{M}\s'.,-]+$/u.test(accountName)) return { ok: false, reason: "Enter the account name using letters only, up to 100 characters." };
  const accountNumber = typeof input.accountNumber === "string" ? input.accountNumber.replace(/[\s-]/g, "") : "";
  if (method !== "bank-transfer" && !/^09\d{9}$/.test(accountNumber)) return { ok: false, reason: "Enter the 11-digit mobile number, starting with 09." };
  if (method === "bank-transfer" && !/^\d{6,20}$/.test(accountNumber)) return { ok: false, reason: "Enter the bank account number, 6 to 20 digits." };
  const bankName = method === "bank-transfer" && typeof input.bankName === "string" ? input.bankName.trim().replace(/\s+/g, " ") : "";
  if (method === "bank-transfer" && (!bankName || bankName.length > 100 || /[<>\u0000-\u001f\u007f]/u.test(bankName))) return { ok: false, reason: "Enter the bank name." };

  return { ok: true, destination: { method, accountName, accountNumber, bankName: bankName || null } };
}

/** Same destination? Used to refuse a "change" that changes nothing. */
export const sameDestination = (a: RefundDestination, b: RefundDestination): boolean =>
  a.method === b.method && a.accountName.toLowerCase() === b.accountName.toLowerCase() && a.accountNumber === b.accountNumber && (a.bankName ?? "").toLowerCase() === (b.bankName ?? "").toLowerCase();

/**
 * Identifies a destination inside an approval request without storing the full number there: the request carries the
 * masked form and this digest, so the Staff member who carries out the approved change must send exactly what was asked.
 */
export function destinationDigest(destination: RefundDestination): string {
  return createHash("sha256").update(JSON.stringify([destination.method, destination.accountName.toLowerCase(), destination.accountNumber, (destination.bankName ?? "").toLowerCase()])).digest("hex");
}

/** Read the storefront's refund_* columns; a Return without a complete destination (an older Return) has none. */
export function readDestination(row: { refund_method?: string | null; refund_account_name?: string | null; refund_account_number?: string | null; refund_bank_name?: string | null }): RefundDestination | null {
  const checked = checkDestination({ method: row.refund_method ?? "", accountName: row.refund_account_name ?? "", accountNumber: row.refund_account_number ?? "", bankName: row.refund_bank_name });

  return checked.ok ? checked.destination : null;
}

/** The destination is fixed once a Manager approves; nothing before that is Staff's to edit either (the Customer owns it until then). */
export const DESTINATION_LOCKED_STATUSES = ["approved", "goods received", "refunded"] as const;

/** A Manager may change a locked destination only while no money has been sent: an approved refund that is not yet Refunded. */
export const mayChangeDestination = (status: string, finalResolution: string | null): boolean =>
  (status === "approved" || status === "goods received") && finalResolution === "refund";
