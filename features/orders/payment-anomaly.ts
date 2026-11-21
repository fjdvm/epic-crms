import type { PaymentRow } from "./payments";
import { rejudge } from "./proof-read";

/**
 * True when a proof looks wrong at a glance: its reference is already on another Order, the amount or date the Customer confirmed
 * fails its rule, or the Proof reader found a Mismatch (for example the image shows ₱90 for a ₱900 Order) or a reused image.
 * A missing or unclear detail is not an anomaly; Staff still see it in the Review dialog. Display only.
 */
export function hasPaymentAnomaly(order: Pick<PaymentRow, "proofChecks" | "proofRead">): boolean {
  const checks = order.proofChecks?.checks;
  if (checks && (!checks.amount.pass && order.proofChecks!.confirmed.amountInCentavos !== null || checks.reference.otherOrderIds.length > 0
    || !checks.date.pass && order.proofChecks!.confirmed.paidAt !== null)) return true;
  const read = order.proofRead;
  if (!read) return false;
  if (read.flags.reusedReferenceOrderIds.length > 0 || read.flags.reusedImageProofIds.length > 0) return true;
  return Object.entries(read.findings ?? {}).some(([field, f]) => {
    const latest = read.corrections.findLast(c => c.field === field);
    if (latest?.kind === "override") return false;
    const finding = latest?.kind === "correction" && latest.value ? rejudge(field as never, latest.value, f.expected) : f.finding;
    return finding === "Mismatch";
  });
}
