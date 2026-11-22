// Mirrors the storefront's lib/returns/refund-record.ts (epic-crms#613). The storefront enforces the same rules when it commits the
// refund; CREOMS checks first so Staff get the reason before a proof is uploaded or an approval is asked for.
import type { ReturnStatus } from "./returns";

/** How the money was sent back. The same three methods the Customer can confirm as a Refund destination. */
export const REFUND_METHODS = [["gcash", "GCash"], ["maya", "Maya"], ["bank-transfer", "Bank transfer"]] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number][0];
export const refundMethodLabel = (method: string) => REFUND_METHODS.find(([value]) => value === method)?.[1] ?? method;

/** What Staff record when they mark a Return Refunded. The proof image travels beside it as its own File. */
export interface RefundRecord { amountInCentavos: number; method: RefundMethod; refundedOn: string; reference: string }

/** Form field names, kept off the words the destination guard refuses (Staff never type where the money goes). */
export const REFUND_FIELDS = { amount: "sentAmount", method: "sentVia", date: "sentOn", reference: "sentReference" } as const;

/** The form field that says Staff verified the real transfer with the payment provider before marking the Return Refunded. */
export const TRANSFER_VERIFIED = "transferVerified";

const manila = (at: Date) => new Date(at.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
export const todayInManila = (now = new Date()) => manila(now);

function pesosToCentavos(value: string): number | null {
  const clean = value.replace(/[₱,\s]/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/**
 * Checks the details Staff typed. `expectedInCentavos` is what the refund rules say to send (items plus any Delivery fee a Manager
 * included); `destinationMethod` is the method the Customer confirmed, if any. Returns the cleaned record or the reason.
 */
export function checkRefundRecord(
  form: FormData | undefined,
  context: { expectedInCentavos: number; destinationMethod: string | null; requestedAt: Date; now?: Date },
): { ok: true; record: RefundRecord } | { ok: false; reason: string } {
  const read = (key: string) => { const value = form?.get(key); return typeof value === "string" ? value.trim() : ""; };
  const amount = pesosToCentavos(read(REFUND_FIELDS.amount));
  if (amount === null) return { ok: false, reason: "Enter the amount sent, in pesos." };
  if (amount !== context.expectedInCentavos) {
    return { ok: false, reason: `The amount sent must match the refund: ₱${(context.expectedInCentavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}.` };
  }
  const method = REFUND_METHODS.find(([value]) => value === read(REFUND_FIELDS.method))?.[0];
  if (!method) return { ok: false, reason: "Choose how the refund was sent: GCash, Maya or Bank transfer." };
  if (context.destinationMethod && context.destinationMethod !== method) {
    return { ok: false, reason: `The Customer confirmed ${refundMethodLabel(context.destinationMethod)} for this refund. Send it that way, or ask a Manager to change the destination first.` };
  }
  const date = read(REFUND_FIELDS.date);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return { ok: false, reason: "Enter the date the refund was sent." };
  }
  if (date > todayInManila(context.now)) return { ok: false, reason: "The refund date cannot be in the future." };
  if (date < manila(context.requestedAt)) return { ok: false, reason: "The refund date cannot be before the Return was requested." };
  const reference = read(REFUND_FIELDS.reference);
  if (reference.length < 4 || reference.length > 100 || /[\u0000-\u001f\u007f<>]/u.test(reference)) {
    return { ok: false, reason: "Enter the transfer reference, 4 to 100 characters." };
  }
  return { ok: true, record: { amountInCentavos: amount, method, refundedOn: date, reference } };
}

/** The Return's label on screen. The stored statuses and APIs stay as they are; only the words differ. */
export function returnLabel(status: ReturnStatus, goodsRequired?: boolean | null): string {
  switch (status) {
    case "requested": return "Pending Review";
    case "declined": return "Rejected";
    case "approved": return goodsRequired === false ? "Returned" : "Awaiting Return";
    case "goods received": return "Returned";
    case "refunded": return "Refunded";
    case "replaced": return "Replaced";
    case "cancelled": return "Cancelled";
  }
}
