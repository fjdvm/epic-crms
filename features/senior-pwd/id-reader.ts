import { z } from "zod";
import type postgres from "postgres";

import { recordAudit, type AuditTrail } from "@/lib/audit-trail";
import { SENIOR_PWD_MODULE } from "@/lib/portal/config";
import { structuredOutput, type StructuredModel } from "@/lib/ai/structured";
import { readImageText } from "@/lib/ocr/read-image-text";
import { fingerprintImage, fingerprintsSimilar } from "@/features/returns/image-fingerprint";
import { nameMatches, parseIdText } from "./id-reading";
import { philippineToday, type IdType } from "./verifications";
import type { IdFindings, IdFlag, IdRead, IdReadState } from "./id-read-types";

export type { IdFindings, IdFlag, IdRead } from "./id-read-types";

/**
 * The ID reader: reads an uploaded Senior/PWD ID photo by itself in the background (Tesseract and a vision model), and
 * stores ONE result per verification with the anomalies it found, so they are ready when a Manager opens the check.
 * It only writes findings. It never approves, declines or changes a verification, and never tells a Customer.
 * The ID number is never asked for, kept, or logged: the storefront compares the number read off the photo itself
 * (`id_number_read`) and only that outcome reaches CREOMS.
 */
/** What the model is asked for: only what the photo shows. No ID number, and nothing about the Customer, goes with it. */
export const idReadSchema = z.object({
  isIdCard: z.boolean(),
  idKind: z.enum(["senior", "pwd", "other"]).nullable(),
  name: z.object({ value: z.string().nullable(), unclear: z.boolean() }),
  expiresOn: z.object({ value: z.string().nullable(), unclear: z.boolean() }),
  looksEdited: z.boolean(),
  editNote: z.string().nullable(),
});
export type IdModelReading = z.infer<typeof idReadSchema>;

const SYSTEM = "You look at a photo of a Philippine Senior Citizen (OSCA) ID or PWD ID. Report only what the photo shows. "
  + "isIdCard is false when the photo is not an ID card at all. idKind is senior for an OSCA / Senior Citizen ID, pwd for a PWD ID, other for any other card. "
  + "Copy the holder's name as printed; set unclear to true when it is blurred or cut off. Write the expiry date as YYYY-MM-DD, or null when none is printed. "
  + "looksEdited is true only for visible signs of tampering: pasted or mismatched text, a replaced photo, inconsistent fonts, or a screen photo of an edited image; explain briefly in editNote. "
  + "Never copy, guess or mention the ID number.";
const PROMPT = "Read this ID photo: is it an ID card, which kind, the holder's name, the expiry date, and any signs of editing.";

export interface IdFacts {
  verificationId: number;
  customerId: string;
  /** The account's name, compared here with what the photo shows; it is never sent to the model. */
  accountName: string;
  idType: IdType;
  fileId: string;
  /** The storefront's comparison of the number read off the photo with the number sent. */
  idNumberRead: "matched" | "differs" | "unread" | null;
}

export interface IdReaderDeps {
  readonly crms: postgres.Sql;
  readonly storefront: postgres.Sql;
  readonly models: StructuredModel[];
  readonly fetchImage: (fileId: string) => Promise<Uint8Array>;
  readonly audit: AuditTrail;
  readonly timeoutMs?: number;
  /** Reads the text printed on the photo. Defaults to the server's Tesseract; a failure only means the model reads alone. */
  readonly ocr?: (image: Uint8Array) => Promise<string>;
  readonly now?: () => Date;
}

const validDate = (value: string | null | undefined) => {
  const v = value?.trim();
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v ? v : null;
};

/** The model's reading with what OCR found filling a name or expiry the model left out. */
export function combineReadings(model: IdModelReading | null, ocrText: string | null) {
  const ocr = ocrText ? parseIdText(ocrText) : null;
  const modelName = model && !model.name.unclear ? model.name.value?.trim() || null : null;
  const modelExpiry = model && !model.expiresOn.unclear ? validDate(model.expiresOn.value) : null;
  return {
    name: modelName ?? ocr?.name ?? null,
    expiresOn: modelExpiry ?? ocr?.expiresOn ?? null,
    idKind: model?.idKind ?? null,
    isIdCard: model?.isIdCard ?? null,
    looksEdited: model?.looksEdited ?? false,
    editNote: model?.looksEdited ? model.editNote?.trim() || null : null,
  };
}

/** Turns a reading into findings and flags. Nothing here decides anything; each flag is for a Manager to look at. */
export function judgeReading(reading: ReturnType<typeof combineReadings>, facts: IdFacts, today: string, reused: number[]) {
  const findings: IdFindings = {
    name: reading.name,
    nameMatches: reading.name ? nameMatches(reading.name, facts.accountName) : null,
    expiresOn: reading.expiresOn,
    idKind: reading.idKind,
    editNote: reading.editNote,
    reusedPhotoVerificationIds: reused,
  };
  const flags: IdFlag[] = [];
  if (!reading.name && !reading.expiresOn && reading.idKind === null) flags.push("unreadable");
  if (reading.isIdCard === false) flags.push("not-an-id");
  if (reading.looksEdited) flags.push("possible-edit");
  if (findings.nameMatches === false) flags.push("name-mismatch");
  if (reading.expiresOn && reading.expiresOn <= today) flags.push("expired");
  if (reading.idKind && reading.idKind !== facts.idType) flags.push("type-mismatch");
  if (facts.idNumberRead === "differs") flags.push("number-differs");
  if (reused.length > 0) flags.push("photo-reused");
  return { findings, flags };
}

const emptyFindings = (reused: number[] = []): IdFindings => ({
  name: null, nameMatches: null, expiresOn: null, idKind: null, editNote: null, reusedPhotoVerificationIds: reused,
});

/**
 * Reads one verification's front photo. Claiming the row first makes a retry, a double call or a concurrent sweep a
 * no-op: only the caller that inserted the row reads. Returns null when the verification already has its result.
 */
export async function readIdPhoto(deps: IdReaderDeps, facts: IdFacts): Promise<IdRead | null> {
  const claimed = await deps.crms`insert into crms.senior_pwd_id_reads (verification_id, customer_id, status)
    values (${facts.verificationId}, ${facts.customerId}, 'reading') on conflict (verification_id) do nothing returning verification_id`;
  if (claimed.length === 0) return null;

  const today = philippineToday(deps.now?.() ?? new Date());
  let fingerprint: string | null = null;
  let failure: string | null = null;
  let result: IdRead;
  try {
    const bytes = await deps.fetchImage(facts.fileId).catch((error: unknown) => { failure = "photo-unavailable"; throw error; });
    fingerprint = await fingerprintImage(bytes).catch(() => null);
    const reused = await reusedPhotos(deps, facts, fingerprint).catch(() => []);
    const [out, text] = await Promise.all([
      structuredOutput({ schema: idReadSchema, system: SYSTEM, prompt: PROMPT, models: deps.models, image: bytes, maxOutputTokens: 300, timeoutMs: deps.timeoutMs ?? 25_000 }),
      (deps.ocr ?? readImageText)(bytes).catch(() => null),
    ]);
    if (!out.ok) failure = out.reason;
    const reading = combineReadings(out.ok ? out.output : null, text);
    const nothing = !out.ok && !reading.name && !reading.expiresOn;
    if (nothing) {
      const flags: IdFlag[] = ["unreadable"];
      if (facts.idNumberRead === "differs") flags.push("number-differs");
      if (reused.length > 0) flags.push("photo-reused");
      result = { verificationId: facts.verificationId, status: "needs-review", findings: emptyFindings(reused), flags, model: null };
    } else {
      const { findings, flags } = judgeReading(reading, facts, today, reused);
      result = { verificationId: facts.verificationId, status: "read", findings, flags, model: out.ok ? out.model : "tesseract.js" };
    }
  } catch {
    failure ??= "error";
    const flags: IdFlag[] = facts.idNumberRead === "differs" ? ["number-differs"] : [];
    result = { verificationId: facts.verificationId, status: "needs-review", findings: emptyFindings(), flags, model: null };
  }

  await deps.crms`update crms.senior_pwd_id_reads set status = ${result.status}, findings = ${deps.crms.json(result.findings as never)},
    flags = ${deps.crms.json(result.flags)}, image_fingerprint = ${fingerprint}, model = ${result.model}, finished_at = now()
    where verification_id = ${facts.verificationId}`;
  // No ID number, name, photo or hash goes into the audit event: only what was flagged.
  await recordAudit(deps.audit, {
    module: SENIOR_PWD_MODULE, action: "pwd.id_read", outcome: result.status === "read" ? "success" : "failure",
    actor: { type: "process", id: "id-reader", display_name: "ID reader" },
    target: { type: "customer", id: facts.customerId, display_name: facts.accountName },
    description: result.status === "read"
      ? `ID reader read Senior/PWD check ${facts.verificationId}${result.flags.length ? `; flagged ${result.flags.join(", ")}` : "; nothing flagged"}`
      : `ID reader could not read Senior/PWD check ${facts.verificationId}; it needs review`,
    occurred_at: new Date().toISOString(), operationId: `id-read:${facts.verificationId}`,
    metadata: { verificationId: facts.verificationId, status: result.status, flags: result.flags, ...(failure ? { failure } : {}) },
  });
  return result;
}

/** Another account's verification whose photo looks like this one. Only flagged; nothing is blocked here. */
async function reusedPhotos(deps: IdReaderDeps, facts: IdFacts, fingerprint: string | null): Promise<number[]> {
  if (!fingerprint) return [];
  const rows = await deps.crms<{ verification_id: number; image_fingerprint: string }[]>`select verification_id, image_fingerprint
    from crms.senior_pwd_id_reads where verification_id <> ${facts.verificationId} and customer_id <> ${facts.customerId}
      and image_fingerprint is not null`;
  return rows.filter(r => fingerprintsSimilar(fingerprint, r.image_fingerprint)).map(r => r.verification_id);
}

const STALE_MINUTES = 15;

/**
 * Reads every waiting verification that still has its photo and no result yet. Runs right after the storefront's
 * signal and on the backstop schedule; opening a check never calls it.
 */
export async function readPendingIdPhotos(deps: IdReaderDeps, only?: number): Promise<{ read: number; needsReview: number; skipped: number }> {
  // A run that died mid-read leaves a claim; it becomes Needs Review, never a second read.
  await deps.crms`update crms.senior_pwd_id_reads set status = 'needs-review', finished_at = now()
    where status = 'reading' and created_at < now() - ${`${STALE_MINUTES} minutes`}::interval`;
  const done = new Set((await deps.crms<{ verification_id: number }[]>`select verification_id from crms.senior_pwd_id_reads`).map(r => r.verification_id));
  const rows = await deps.storefront<{ id: number; customer_id: string; full_name: string; id_type: IdType; photo_file_id: string; id_number_read: IdFacts["idNumberRead"] }[]>`
    select v.id, v.customer_id, c.full_name, v.id_type, v.photo_file_id, v.id_number_read
    from public.senior_pwd_verifications v join public.customers c on c.id = v.customer_id
    where v.status = 'pending' and v.photo_file_id is not null and v.submitted_at > now() - interval '7 days'
      and (${only ?? null}::int is null or v.id = ${only ?? null}::int)
    order by v.submitted_at limit 25`;
  const counts = { read: 0, needsReview: 0, skipped: 0 };
  for (const r of rows) {
    if (done.has(r.id)) { counts.skipped++; continue; }
    const result = await readIdPhoto(deps, {
      verificationId: r.id, customerId: r.customer_id, accountName: r.full_name, idType: r.id_type, fileId: r.photo_file_id, idNumberRead: r.id_number_read ?? null,
    }).catch(() => null);
    if (!result) counts.skipped++; else if (result.status === "read") counts.read++; else counts.needsReview++;
  }
  return counts;
}

/** The stored result for one verification, for the check screen and the Approvals list. */
export async function loadIdRead(crms: postgres.Sql, verificationId: number): Promise<IdReadState> {
  const [row] = await crms<{ status: string; findings: IdFindings | null; flags: IdFlag[] | null; model: string | null }[]>`
    select status, findings, flags, model from crms.senior_pwd_id_reads where verification_id = ${verificationId}`;
  if (!row) return null;
  if (row.status === "reading") return { status: "reading" };
  return { verificationId, status: row.status as IdRead["status"], findings: row.findings ?? emptyFindings(), flags: row.flags ?? [], model: row.model };
}

/** Flag counts for many verifications at once (Approvals list). */
export async function loadIdReadFlags(crms: postgres.Sql, ids: number[]): Promise<Map<number, IdFlag[]>> {
  if (ids.length === 0) return new Map();
  const rows = await crms<{ verification_id: number; flags: IdFlag[] | null }[]>`
    select verification_id, flags from crms.senior_pwd_id_reads where verification_id = any(${ids}::int[]) and status <> 'reading'`;
  return new Map(rows.map(r => [r.verification_id, r.flags ?? []]));
}
