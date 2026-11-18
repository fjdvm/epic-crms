import type postgres from "postgres";

import type { Findings, ReadFlags } from "./proof-reader";

/** What Staff see beside a proof: the Proof reader's stored result (#595). Reading it never calls the model. */
export interface ProofReadView {
  /** `pending` while the reader has not finished (or never ran); `needs-review` when the read failed. */
  status: "pending" | "read" | "needs-review";
  findings: Findings | null;
  flags: ReadFlags;
}

interface Row { proof_id: number; status: "reading" | "read" | "needs-review"; findings: Findings | null; flags: Partial<ReadFlags> | null }

/** One query for many proofs. A proof with no row has not been read yet. Read-only. */
export async function proofReadsFor(crms: postgres.Sql, proofIds: number[]): Promise<Record<number, ProofReadView>> {
  if (proofIds.length === 0) return {};
  const rows = await crms<Row[]>`select proof_id, status, findings, flags from crms.payment_proof_reads where proof_id in ${crms(proofIds)}`;
  const out: Record<number, ProofReadView> = {};
  for (const r of rows) {
    out[r.proof_id] = {
      status: r.status === "reading" ? "pending" : r.status,
      findings: r.findings,
      flags: { reusedReferenceOrderIds: r.flags?.reusedReferenceOrderIds ?? [], reusedImageProofIds: r.flags?.reusedImageProofIds ?? [] },
    };
  }
  return out;
}

/** A failed read must never take the Order page down: Staff just see that nothing was read. */
export async function proofReadsOrEmpty(crms: postgres.Sql, proofIds: number[]): Promise<Record<number, ProofReadView>> {
  try { return await proofReadsFor(crms, proofIds); } catch (error) {
    console.error("Proof reader findings could not be read", error);
    return {};
  }
}
