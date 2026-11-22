import type postgres from "postgres";

import type { ProofCorrection } from "@/features/orders/proof-read";
import type { Field, Finding } from "@/features/orders/proof-reader";
import type { RefundDraft } from "./refund-review";

interface DraftRow { return_id: number; proof_file_id: string; amount_in_centavos: number; expected_in_centavos: number; method: string; refunded_on: string;
  reference: string; delivery_fee_reason: string | null; saved_by_name: string; saved_at: Date }

/** The refund proof Staff saved for a Return that is not Refunded yet; null when there is none. Read-only. */
export async function loadRefundDraft(crms: postgres.Sql, returnId: number): Promise<RefundDraft | null> {
  const [row] = await crms<DraftRow[]>`select return_id, proof_file_id, amount_in_centavos, expected_in_centavos, method, refunded_on, reference, delivery_fee_reason, saved_by_name, saved_at
    from crms.refund_proof_drafts where return_id = ${returnId}`;

  return row ? { returnId: row.return_id, fileId: row.proof_file_id, amountInCentavos: row.amount_in_centavos, expectedInCentavos: row.expected_in_centavos, method: row.method,
    refundedOn: row.refunded_on, reference: row.reference, deliveryFeeReason: row.delivery_fee_reason, savedByName: row.saved_by_name, savedAt: row.saved_at } : null;
}

/** Every correction and decision to proceed recorded against one saved refund proof, oldest first. */
export async function loadRefundCorrections(crms: postgres.Sql, fileId: string): Promise<ProofCorrection[]> {
  const rows = await crms<{ kind: "correction" | "override"; field: Field; original_value: string | null; corrected_value: string | null; original_finding: Finding; reason: string; by_name: string; created_at: Date }[]>`
    select kind, field, original_value, corrected_value, original_finding, reason, by_name, created_at from crms.refund_proof_corrections where proof_file_id = ${fileId} order by id`;

  return rows.map((c) => ({ kind: c.kind, field: c.field, value: c.corrected_value, originalValue: c.original_value, originalFinding: c.original_finding, reason: c.reason, by: c.by_name, at: c.created_at }));
}
