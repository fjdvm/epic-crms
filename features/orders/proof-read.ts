import type postgres from "postgres";

import type { Field, Finding, Findings, ReadFlags } from "./proof-reader";

/** One recorded change to a reading. The original stays in the Proof reader's row; these only add to it (#597). */
export interface ProofCorrection {
  kind: "correction" | "override";
  field: Field;
  /** The value Staff typed; null for an override. */
  value: string | null;
  originalValue: string | null;
  originalFinding: Finding;
  reason: string;
  by: string;
  at: Date;
}

/** What Staff see beside a proof: the Proof reader's stored result (#595). Reading it never calls the model. */
export interface ProofReadView {
  /** `pending` while the reader has not finished (or never ran); `needs-review` when the read failed. */
  status: "pending" | "read" | "needs-review";
  findings: Findings | null;
  flags: ReadFlags;
  /** Every correction and override, oldest first. The latest per field is what Staff are working from. */
  corrections: ProofCorrection[];
}

interface CorrectionRow { proof_id: number; kind: "correction" | "override"; field: Field; original_value: string | null; corrected_value: string | null; original_finding: Finding; reason: string; by_name: string; created_at: Date }

/** Compares a typed correction with what the Order expects, in the same words the reader used. */
export function rejudge(field: Field, value: string, expected: string | null): Finding {
  const v = value.trim();
  if (!v || !expected) return "Needs Review";
  const norm = (x: string) => x.trim().toLowerCase().replace(/[\s-]/g, "");
  if (field === "amount") {
    const a = Number(v.replace(/[^\d.]/g, "")), b = Number(expected.replace(/[^\d.]/g, ""));
    return Number.isFinite(a) && Number.isFinite(b) && v.replace(/[^\d.]/g, "") ? (Math.round(a * 100) === Math.round(b * 100) ? "Match" : "Mismatch") : "Needs Review";
  }
  if (field === "date") {
    const d = new Date(v), after = /\d{4}-\d{2}-\d{2}/.exec(expected)?.[0];
    if (Number.isNaN(d.getTime()) || !after) return "Needs Review";
    return d.getTime() >= new Date(after).getTime() - 86_400_000 ? "Match" : "Mismatch";
  }
  if (field === "accountNumber") return norm(v).replace(/\D/g, "") === norm(expected).replace(/\D/g, "") ? "Match" : "Mismatch";
  return norm(v) === norm(expected) ? "Match" : "Mismatch";
}

interface Row { proof_id: number; status: "reading" | "read" | "needs-review"; findings: Findings | null; flags: Partial<ReadFlags> | null }

/** One query for many proofs. A proof with no row has not been read yet. Read-only. */
export async function proofReadsFor(crms: postgres.Sql, proofIds: number[]): Promise<Record<number, ProofReadView>> {
  if (proofIds.length === 0) return {};
  const rows = await crms<Row[]>`select proof_id, status, findings, flags from crms.payment_proof_reads where proof_id in ${crms(proofIds)}`;
  const changes = await crms<CorrectionRow[]>`select proof_id, kind, field, original_value, corrected_value, original_finding, reason, by_name, created_at
    from crms.payment_proof_corrections where proof_id in ${crms(proofIds)} order by id`;
  const out: Record<number, ProofReadView> = {};
  for (const r of rows) {
    out[r.proof_id] = {
      status: r.status === "reading" ? "pending" : r.status,
      findings: r.findings,
      flags: { reusedReferenceOrderIds: r.flags?.reusedReferenceOrderIds ?? [], reusedImageProofIds: r.flags?.reusedImageProofIds ?? [] },
      corrections: changes.filter(c => c.proof_id === r.proof_id).map(c => ({ kind: c.kind, field: c.field, value: c.corrected_value, originalValue: c.original_value,
        originalFinding: c.original_finding, reason: c.reason, by: c.by_name, at: c.created_at })),
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
