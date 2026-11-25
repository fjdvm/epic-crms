import { revalidatePath } from "next/cache";
import { vi } from "vitest";
import { gatewayAuditTrail } from "@/lib/gateway";
import type postgres from "postgres";

import { markReturnRefunded } from "@/features/returns/actions";
import { saveRefundProof } from "@/features/returns/refund-proof-actions";
import { TRANSFER_VERIFIED } from "@/features/returns/refund-record";
import type { ApprovalOptions, ApprovalResult } from "@/features/approvals/workflow";
import type { ReturnChangeResult } from "@/lib/storefront";

/** The CREOMS tables the two-step refund needs: the saved proof, the Proof reader's results and the corrections (#614, #615). */
export const REFUND_PROOF_SQL = ["docs/db/crms-refund-proof-reads.sql", "docs/db/crms-refund-proof-drafts.sql", "docs/db/crms-pending-audit.sql"];
export const REFUND_PROOF_TABLES = "crms.refund_proof_drafts, crms.refund_proof_reads, crms.refund_proof_corrections, crms.pending_audit_records";

/**
 * The whole refund the way Staff do it: save the proof and details, let the Proof reader finish (a read that failed shows Needs Review and
 * never blocks), then mark the Return Refunded after confirming the real transfer was verified.
 */
export async function refundVia(sql: postgres.Sql, id: number, form: FormData | undefined, options?: ApprovalOptions): Promise<ReturnChangeResult | ApprovalResult> {
  const saved = await saveRefundProof(id, form as FormData);
  if (!saved.ok) return saved;
  const [draft] = await sql<{ proof_file_id: string }[]>`select proof_file_id from crms.refund_proof_drafts where return_id = ${id}`;
  await sql`insert into crms.refund_proof_reads (proof_file_id, return_id, status) values (${draft.proof_file_id}, ${id}, 'needs-review') on conflict do nothing`;
  // Saving the proof refreshes the page; what these tests watch is whether marking it Refunded did (the save has its own tests).
  vi.mocked(revalidatePath).mockClear();
  const audited = vi.mocked(gatewayAuditTrail).mock?.calls ?? [];
  for (let i = audited.length - 1; i >= 0; i--) if (audited[i][0].action === "return.refund_proof_saved") audited.splice(i, 1);
  const verify = new FormData();
  verify.set(TRANSFER_VERIFIED, "true");

  return markReturnRefunded(id, verify, options);
}
