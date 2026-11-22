import { z } from "zod";
import type postgres from "postgres";

import { recordAudit, type AuditTrail } from "@/lib/audit-trail";
import { structuredOutput, type StructuredModel } from "@/lib/ai/structured";
import { readImageText } from "@/lib/ocr/read-image-text";
import { readReceiptText } from "@/lib/ocr/receipt-text";
import { fingerprintImage, fingerprintsSimilar } from "@/features/returns/image-fingerprint";

/**
 * The Proof reader (#595): reads a saved payment proof by itself in the background, compares what it read
 * with the Order and the account the Customer chose, and stores ONE result per proof. It only writes findings.
 * It never approves or rejects a payment, changes a status, or tells a Customer. Staff still verify the real transfer.
 */
export type Finding = "Match" | "Mismatch" | "Missing" | "Needs Review";
export const FIELDS = ["amount", "date", "reference", "recipient", "accountNumber"] as const;
export type Field = (typeof FIELDS)[number];
export type Findings = Record<Field, { finding: Finding; read: string | null; expected: string | null }>;
export interface ReadFlags { reusedReferenceOrderIds: number[]; reusedImageProofIds: number[] }
export interface ProofRead { proofId: number; status: "read" | "needs-review"; findings: Findings; flags: ReadFlags; model: string | null }

/** What the model is asked for: only what is printed on the image. Nothing else about the Order or Customer goes with it. */
const fieldSchema = z.object({ value: z.string().nullable(), unclear: z.boolean() });
export const readSchema = z.object({
  amount: fieldSchema, date: fieldSchema, reference: fieldSchema, recipient: fieldSchema, accountNumber: fieldSchema,
});
export type ModelReading = z.infer<typeof readSchema>;

const SYSTEM = "You read a screenshot of a GCash, Maya or bank transfer receipt. Copy only what is printed. "
  + "Set value to null when a detail is not shown, and unclear to true when it is blurred, cut off, or partly masked (for example with asterisks). "
  + "Never guess or complete a hidden digit. For the recipient account number, copy it as printed (masked digits stay as asterisks) and set unclear to true only when its last four digits are not clearly legible. Write the date as YYYY-MM-DD and the amount with its digits only.";
const PROMPT = "Extract the transfer amount, payment date, reference number, recipient name and recipient account number.";

export interface ProofFacts {
  proofId: number; orderId: number; fileId: string; reference: string | null;
  totalInCentavos: number; orderPlacedAt: Date;
  accountName: string | null; accountNumber: string | null;
}

const norm = (v: string) => v.trim().toLowerCase().replace(/[\s-]/g, "");
const MASK = /[*•xX]{2,}|\.{3}/;
const missing = (expected: string | null) => ({ finding: "Missing" as const, read: null, expected });

function amountCentavos(value: string): number | null {
  const digits = value.replace(/[^\d.]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  return Math.round(Number(digits) * 100);
}

/** A masked, unclear or unparseable detail is Needs Review and a hidden one Missing: never an assumed Match. */
export function compareReading(reading: ModelReading, facts: ProofFacts): Findings {
  const peso = (c: number) => `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
  const last4 = (v: string) => { const d = v.replace(/\D/g, ""); return d.length >= 4 ? d.slice(-4) : null; };
  const field = (key: Field, expected: string | null, judge: (read: string) => Finding | null) => {
    const { value, unclear } = reading[key];
    const read = value?.trim() || null;
    if (!read) return missing(expected);
    // Receipts mask the account number, so only its last four digits are compared; masking elsewhere is fine.
    if (key === "accountNumber") return { finding: (unclear ? null : judge(read)) ?? ("Needs Review" as const), read, expected };
    if (unclear || MASK.test(read)) return { finding: "Needs Review" as const, read, expected };
    return { finding: judge(read) ?? ("Needs Review" as const), read, expected };
  };
  return {
    amount: field("amount", peso(facts.totalInCentavos), r => { const c = amountCentavos(r); return c === null ? null : c === facts.totalInCentavos ? "Match" : "Mismatch"; }),
    date: field("date", `after ${facts.orderPlacedAt.toISOString().slice(0, 10)}`, r => {
      const d = new Date(r); if (Number.isNaN(d.getTime())) return null;
      // Receipts show a day, so the placing day itself is still fine.
      return d.getTime() >= Date.UTC(facts.orderPlacedAt.getUTCFullYear(), facts.orderPlacedAt.getUTCMonth(), facts.orderPlacedAt.getUTCDate()) - 86_400_000 ? "Match" : "Mismatch";
    }),
    reference: field("reference", facts.reference, r => facts.reference?.trim() ? (norm(r) === norm(facts.reference) ? "Match" : "Mismatch") : null),
    recipient: field("recipient", facts.accountName, r => facts.accountName?.trim() ? (norm(r) === norm(facts.accountName) ? "Match" : "Mismatch") : null),
    accountNumber: field("accountNumber", facts.accountNumber, r => { const a = last4(r), b = facts.accountNumber ? last4(facts.accountNumber) : null; return a && b ? (a === b ? "Match" : "Mismatch") : null; }),
  };
}

export const allNeedReview = (facts: ProofFacts): Findings =>
  Object.fromEntries(FIELDS.map(f => [f, { finding: "Needs Review", read: null, expected: null }])) as Findings;

export interface ReaderDeps {
  readonly crms: postgres.Sql;
  readonly storefront: postgres.Sql;
  readonly models: StructuredModel[];
  readonly fetchImage: (fileId: string) => Promise<Uint8Array>;
  readonly audit: AuditTrail;
  readonly timeoutMs?: number;
  /** Reads the text printed on the image (OCR). Defaults to the server's Tesseract; a failure only means the model reads alone. */
  readonly ocr?: (image: Uint8Array) => Promise<string>;
}

/** What OCR alone could read, in the model's shape. The recipient name is not parsed by OCR, so it is left for Staff. */
export function ocrReading(text: string): ModelReading {
  const r = readReceiptText(text);
  const f = (value: string | undefined) => ({ value: value ?? null, unclear: false });
  // A masked number such as "09** *** 7289" or "****7289": keep the masked shape so only the last four digits count.
  const account = /(?:\+?\d[\d ]{0,5})?[*•●xX·]{2,}[\s*•●xX·-]*(\d{4})\b/.exec(text)?.[0].trim();
  return { amount: f(r.amountInCentavos === undefined ? undefined : (r.amountInCentavos / 100).toFixed(2)), date: f(r.paidAt), reference: f(r.reference), recipient: f(undefined), accountNumber: f(account) };
}

/** The model's reading with OCR filling any detail the model could not find. */
export function mergeReadings(model: ModelReading, ocr: ModelReading | null): ModelReading {
  if (!ocr) return model;
  const pick = (k: Field) => (model[k].value?.trim() ? model[k] : ocr[k]);
  return { amount: pick("amount"), date: pick("date"), reference: pick("reference"), recipient: model.recipient, accountNumber: pick("accountNumber") };
}

/**
 * Reads one proof. Claiming the row first is what makes a retry, a double call or a concurrent sweep a no-op:
 * only the caller that inserted the row reads. Returns null when the proof already has its result.
 */
export async function readProof(deps: ReaderDeps, facts: ProofFacts): Promise<ProofRead | null> {
  const claimed = await deps.crms`insert into crms.payment_proof_reads (proof_id, order_id, status) values (${facts.proofId}, ${facts.orderId}, 'reading')
    on conflict (proof_id) do nothing returning proof_id`;
  if (claimed.length === 0) return null;

  let result: ProofRead; let fingerprint: string | null = null; let failure: string | null = null;
  try {
    const bytes = await deps.fetchImage(facts.fileId).catch((error: unknown) => { failure = "image-unavailable"; throw error; });
    fingerprint = await fingerprintImage(bytes).catch(() => null);
    const [out, text] = await Promise.all([
      structuredOutput({ schema: readSchema, system: SYSTEM, prompt: PROMPT, models: deps.models, image: bytes, maxOutputTokens: 400, timeoutMs: deps.timeoutMs ?? 25_000 }),
      (deps.ocr ?? readImageText)(bytes).catch(() => null),
    ]);
    const ocr = text === null ? null : ocrReading(text);
    const ocrFound = ocr !== null && [ocr.amount, ocr.date, ocr.reference].some(x => x.value);
    if (out.ok) {
      result = { proofId: facts.proofId, status: "read", findings: compareReading(mergeReadings(out.output, ocr), facts), flags: { reusedReferenceOrderIds: [], reusedImageProofIds: [] }, model: out.model };
    } else if (ocr && ocrFound) {
      // The model was unavailable: the OCR's reading stands alone, and what it cannot read stays Needs Review.
      failure = out.reason;
      const findings = compareReading(ocr, facts);
      // OCR not finding a detail is not the same as the receipt not showing it, so nothing is called Missing here.
      for (const k of FIELDS) if (findings[k].finding === "Missing" || k === "recipient") findings[k] = { finding: "Needs Review", read: null, expected: findings[k].expected };
      result = { proofId: facts.proofId, status: "read", findings, flags: { reusedReferenceOrderIds: [], reusedImageProofIds: [] }, model: "tesseract.js" };
    } else {
      failure = out.reason;
      result = { proofId: facts.proofId, status: "needs-review", findings: allNeedReview(facts), flags: { reusedReferenceOrderIds: [], reusedImageProofIds: [] }, model: null };
    }
  } catch {
    failure ??= "error";
    result = { proofId: facts.proofId, status: "needs-review", findings: allNeedReview(facts), flags: { reusedReferenceOrderIds: [], reusedImageProofIds: [] }, model: null };
  }
  result.flags = await reuseFlags(deps, facts, fingerprint).catch(() => result.flags);

  await deps.crms`update crms.payment_proof_reads set status = ${result.status}, findings = ${deps.crms.json(result.findings)},
    flags = ${deps.crms.json(result.flags as never)}, image_fingerprint = ${fingerprint}, model = ${result.model}, finished_at = now() where proof_id = ${facts.proofId}`;
  await recordAudit(deps.audit, {
    module: "orders", action: "payment_proof.read", outcome: result.status === "read" ? "success" : "failure",
    actor: { type: "process", id: "proof-reader", display_name: "Proof reader" },
    target: { type: "order", id: String(facts.orderId), display_name: `Order #${facts.orderId}` },
    description: result.status === "read" ? `Proof reader read payment proof ${facts.proofId} of Order #${facts.orderId}` : `Proof reader could not read payment proof ${facts.proofId} of Order #${facts.orderId}; it needs review`,
    occurred_at: new Date().toISOString(), operationId: `proof-read:${facts.proofId}`,
    metadata: { proofId: facts.proofId, status: result.status, ...(failure ? { failure } : {}), findings: Object.fromEntries(FIELDS.map(f => [f, result.findings[f].finding])), flags: result.flags },
  });
  return result;
}

/** A reused reference or a similar image on another proof is only flagged; nothing is blocked here. */
async function reuseFlags(deps: ReaderDeps, facts: ProofFacts, fingerprint: string | null): Promise<ReadFlags> {
  const refs = facts.reference?.trim()
    ? await deps.storefront<{ id: number }[]>`select distinct o.id from public.orders o where o.id <> ${facts.orderId} and (
        lower(trim(o.gcash_reference_number)) = lower(trim(${facts.reference})) or exists (select 1 from public.order_payment_proofs p
          where p.order_id = o.id and lower(trim(p.reference)) = lower(trim(${facts.reference})))) order by o.id`
    : [];
  const images = fingerprint
    ? (await deps.crms<{ proof_id: number; image_fingerprint: string }[]>`select proof_id, image_fingerprint from crms.payment_proof_reads
        where proof_id <> ${facts.proofId} and order_id <> ${facts.orderId} and image_fingerprint is not null`)
        .filter(r => fingerprintsSimilar(fingerprint, r.image_fingerprint)).map(r => r.proof_id)
    : [];
  return { reusedReferenceOrderIds: refs.map(r => r.id), reusedImageProofIds: images };
}

const SWEEP_DAYS = 7;
const STALE_MINUTES = 15;

/** Reads every recent proof that has an image and no result yet. Runs on a schedule or when the storefront names a proof; viewing never calls it. */
export async function readPendingProofs(deps: ReaderDeps, only?: number): Promise<{ read: number; needsReview: number; skipped: number }> {
  // A run that died mid-read leaves a claim; it becomes Needs Review, never a second read.
  await deps.crms`update crms.payment_proof_reads set status = 'needs-review', finished_at = now()
    where status = 'reading' and created_at < now() - ${`${STALE_MINUTES} minutes`}::interval`;
  const done = new Set((await deps.crms<{ proof_id: number }[]>`select proof_id from crms.payment_proof_reads`).map(r => r.proof_id));
  const rows = await deps.storefront<{ id: number; order_id: number; file: string; reference: string | null; total: number; created_at: Date; account_name: string | null; account_number: string | null }[]>`
    select p.id, p.order_id, p.screenshot_file_id as file, p.reference, o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0) as total,
      o.created_at, p.account_name, p.account_number
    from public.order_payment_proofs p join public.orders o on o.id = p.order_id
    where p.screenshot_file_id is not null and p.rejected_at is null
      and (${only ?? null}::int is null and p.submitted_at > now() - make_interval(days => ${SWEEP_DAYS}) or p.id = ${only ?? null}::int)
    order by p.submitted_at limit 25`;
  const counts = { read: 0, needsReview: 0, skipped: 0 };
  for (const r of rows) {
    if (done.has(r.id)) { counts.skipped++; continue; }
    const result = await readProof(deps, { proofId: r.id, orderId: r.order_id, fileId: r.file, reference: r.reference, totalInCentavos: Number(r.total), orderPlacedAt: r.created_at, accountName: r.account_name, accountNumber: r.account_number }).catch(() => null);
    if (!result) counts.skipped++; else if (result.status === "read") counts.read++; else counts.needsReview++;
  }
  return counts;
}
