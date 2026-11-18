import type postgres from "postgres";

import { recordAudit, type AuditTrail } from "@/lib/audit-trail";
import { structuredOutput, type StructuredModel } from "@/lib/ai/structured";
import { allNeedReview, compareReading, FIELDS, readSchema, type ProofFacts, type Findings } from "@/features/orders/proof-reader";

/**
 * The Proof reader for a refund proof (#614). Same job as the payment proof reader: it reads the image Staff uploaded in the
 * background, compares it with the approved refund amount and the Customer's confirmed destination, and stores ONE result per proof.
 * It only writes findings. It never marks anything Refunded, changes a status or tells a Customer; Staff verify the real transfer.
 */
export interface RefundProofFacts {
  returnId: number; orderId: number; fileId: string;
  /** What the refund rules say to send: items plus any Delivery fee a Manager included. */
  expectedInCentavos: number; requestedAt: Date;
  /** The reference Staff typed when they marked it Refunded. */
  reference: string | null;
  destinationName: string | null; destinationNumber: string | null;
}
export interface RefundProofRead { returnId: number; status: "read" | "needs-review"; findings: Findings; model: string | null }

const SYSTEM = "You read a screenshot of a GCash, Maya or bank transfer receipt for money that was sent out. Copy only what is printed. "
  + "Set value to null when a detail is not shown, and unclear to true when it is blurred, cut off, or partly masked (for example with asterisks). "
  + "Never guess or complete a hidden digit. Write the date as YYYY-MM-DD and the amount with its digits only.";
const PROMPT = "Extract the transfer amount, payment date, reference number, recipient name and recipient account number.";

/** Same comparison as a payment proof, with the refund's facts in place of the Order's. */
const asProofFacts = (f: RefundProofFacts): ProofFacts => ({
  proofId: f.returnId, orderId: f.orderId, fileId: f.fileId, reference: f.reference, totalInCentavos: f.expectedInCentavos,
  orderPlacedAt: f.requestedAt, accountName: f.destinationName, accountNumber: f.destinationNumber,
});

export interface RefundReaderDeps {
  readonly crms: postgres.Sql;
  readonly storefront: postgres.Sql;
  readonly models: StructuredModel[];
  readonly fetchImage: (fileId: string) => Promise<Uint8Array>;
  readonly audit: AuditTrail;
  readonly timeoutMs?: number;
}

/** Claiming the row first makes a retry, a double call or a concurrent sweep a no-op. Returns null when the proof already has its result. */
export async function readRefundProof(deps: RefundReaderDeps, facts: RefundProofFacts): Promise<RefundProofRead | null> {
  const claimed = await deps.crms`insert into crms.refund_proof_reads (proof_file_id, return_id, status) values (${facts.fileId}, ${facts.returnId}, 'reading')
    on conflict (proof_file_id) do nothing returning proof_file_id`;
  if (claimed.length === 0) return null;

  const shared = asProofFacts(facts);
  let result: RefundProofRead;
  try {
    const bytes = await deps.fetchImage(facts.fileId);
    const out = await structuredOutput({ schema: readSchema, system: SYSTEM, prompt: PROMPT, models: deps.models, image: bytes, maxOutputTokens: 400, timeoutMs: deps.timeoutMs ?? 25_000 });
    result = out.ok
      ? { returnId: facts.returnId, status: "read", findings: compareReading(out.output, shared), model: out.model }
      : { returnId: facts.returnId, status: "needs-review", findings: allNeedReview(shared), model: null };
  } catch {
    result = { returnId: facts.returnId, status: "needs-review", findings: allNeedReview(shared), model: null };
  }

  await deps.crms`update crms.refund_proof_reads set status = ${result.status}, findings = ${deps.crms.json(result.findings)},
    model = ${result.model}, finished_at = now() where proof_file_id = ${facts.fileId}`;
  await recordAudit(deps.audit, {
    module: "returns", action: "refund_proof.read", outcome: result.status === "read" ? "success" : "failure",
    actor: { type: "process", id: "proof-reader", display_name: "Proof reader" },
    target: { type: "return", id: String(facts.returnId), display_name: `Return RMA-${facts.returnId}` },
    description: result.status === "read" ? `Proof reader read the refund proof of Return RMA-${facts.returnId} (Order #${facts.orderId})` : `Proof reader could not read the refund proof of Return RMA-${facts.returnId} (Order #${facts.orderId}); it needs review`,
    occurred_at: new Date().toISOString(), operationId: `refund-proof-read:${facts.fileId}`,
    metadata: { returnId: facts.returnId, status: result.status, findings: Object.fromEntries(FIELDS.map(f => [f, result.findings[f].finding])) },
  });
  return result;
}

const SWEEP_DAYS = 7;
const STALE_MINUTES = 15;

interface PendingRow {
  id: number; order_id: number; file: string; amount: number; fee: number | null; paid: number | null; requested_at: Date;
  reference: string | null; dest_name: string | null; dest_number: string | null;
}

/** Reads every recently refunded Return whose proof has no result yet. Runs on a schedule or right after Staff save the proof; viewing never calls it. */
export async function readPendingRefundProofs(deps: RefundReaderDeps, only?: number): Promise<{ read: number; needsReview: number; skipped: number }> {
  await deps.crms`update crms.refund_proof_reads set status = 'needs-review', finished_at = now()
    where status = 'reading' and created_at < now() - ${`${STALE_MINUTES} minutes`}::interval`;
  const done = new Set((await deps.crms<{ proof_file_id: string }[]>`select proof_file_id from crms.refund_proof_reads`).map(r => r.proof_file_id));
  const rows = await deps.storefront<PendingRow[]>`
    select r.id, r.order_id, r.refund_proof_file_id as file, r.amount_in_centavos as amount,
      (to_jsonb(r)->>'refund_delivery_fee_in_centavos')::int as fee, (to_jsonb(r)->>'refund_amount_in_centavos')::int as paid, r.requested_at,
      to_jsonb(r)->>'refund_reference' as reference, to_jsonb(r)->>'refund_account_name' as dest_name, to_jsonb(r)->>'refund_account_number' as dest_number
    from public.order_returns r
    where r.status = 'refunded' and r.refund_proof_file_id is not null
      and (${only ?? null}::int is null and r.refunded_at > now() - make_interval(days => ${SWEEP_DAYS}) or r.id = ${only ?? null}::int)
    order by r.refunded_at limit 25`;
  const counts = { read: 0, needsReview: 0, skipped: 0 };
  for (const r of rows) {
    if (done.has(r.file)) { counts.skipped++; continue; }
    const result = await readRefundProof(deps, {
      returnId: r.id, orderId: r.order_id, fileId: r.file, expectedInCentavos: r.paid !== null ? Number(r.paid) : Number(r.amount) + Number(r.fee ?? 0), requestedAt: r.requested_at,
      reference: r.reference, destinationName: r.dest_name, destinationNumber: r.dest_number,
    }).catch(() => null);
    if (!result) counts.skipped++; else if (result.status === "read") counts.read++; else counts.needsReview++;
  }
  return counts;
}

/** What Staff see beside a refund proof. Reading it never calls the model; a failed read just shows nothing read yet. */
export async function refundProofReadFor(crms: postgres.Sql, fileId: string | null): Promise<{ status: "pending" | "read" | "needs-review"; findings: Findings | null } | null> {
  if (!fileId) return null;
  try {
    const [row] = await crms<{ status: "reading" | "read" | "needs-review"; findings: Findings | null }[]>`select status, findings from crms.refund_proof_reads where proof_file_id = ${fileId}`;
    return row ? { status: row.status === "reading" ? "pending" : row.status, findings: row.findings } : { status: "pending", findings: null };
  } catch (error) {
    console.error("Refund proof findings could not be read", error);
    return null;
  }
}
