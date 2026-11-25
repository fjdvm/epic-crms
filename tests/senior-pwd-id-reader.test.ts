import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import sharp from "sharp";

import { combineReadings, judgeReading, readIdPhoto, readPendingIdPhotos, type IdFacts, type IdModelReading, type IdReaderDeps } from "@/features/senior-pwd/id-reader";

const NUMBER = "SC-123-456-789";
const facts: IdFacts = { verificationId: 5, customerId: "c1", accountName: "Maria Dela Cruz", idType: "senior", fileId: "f5", idNumberRead: "matched" };
const f = (value: string | null, unclear = false) => ({ value, unclear });
const clean: IdModelReading = {
  isIdCard: true, idKind: "senior", name: f("DELA CRUZ, MARIA S."), expiresOn: f("2030-05-01"), looksEdited: false, editNote: null,
};
const TODAY = "2026-11-23";

/** A recording stand-in for the two databases: it keeps the id_reads rows and answers by statement text. */
function fakeDb(opts: { existing?: number[]; sibling?: { verification_id: number; image_fingerprint: string }[]; pending?: Record<string, unknown>[] } = {}) {
  const rows = new Map<number, Record<string, unknown>>((opts.existing ?? []).map(id => [id, { status: "read" }]));
  const crms = Object.assign(async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?");
    if (q.includes("insert into crms.senior_pwd_id_reads")) { if (rows.has(v[0] as number)) return []; rows.set(v[0] as number, { status: "reading" }); return [{ verification_id: v[0] }]; }
    if (q.includes("set status = 'needs-review', finished_at")) return [];
    if (q.startsWith("update crms.senior_pwd_id_reads")) { rows.set(v.at(-1) as number, { status: v[0], findings: v[1], flags: v[2], fingerprint: v[3], model: v[4] }); return []; }
    if (q.includes("select verification_id from")) return [...rows.keys()].map(verification_id => ({ verification_id }));
    if (q.includes("image_fingerprint")) return opts.sibling ?? [];
    throw new Error(`unexpected crms sql: ${q}`);
  }, { json: (x: unknown) => x });
  const storefront = async (strings: TemplateStringsArray) => {
    const q = strings.join("?");
    if (q.includes("from public.senior_pwd_verifications v")) return opts.pending ?? [];
    throw new Error(`unexpected storefront sql: ${q}`);
  };
  return { rows, crms: crms as never, storefront: storefront as never };
}
const modelReturning = (json: unknown) => new MockLanguageModelV4({ doGenerate: async () => ({
  content: [{ type: "text", text: JSON.stringify(json) }], finishReason: { unified: "stop", raw: undefined },
  usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } }, warnings: [],
}) });
const failingModel = () => new MockLanguageModelV4({ doGenerate: async () => { throw new Error("model down"); } });
const png = () => sharp({ create: { width: 40, height: 40, channels: 3, background: "#456" } }).png().toBuffer();
const deps = (db: ReturnType<typeof fakeDb>, model: MockLanguageModelV4, extra: Partial<IdReaderDeps> = {}): IdReaderDeps => ({
  crms: db.crms, storefront: db.storefront, models: [{ name: "fake", model }], fetchImage: async () => png(),
  ocr: async () => "", audit: vi.fn(async () => {}), now: () => new Date(`${TODAY}T04:00:00Z`), ...extra,
});

describe("judging what the ID reader saw", () => {
  it("flags nothing on a clean, matching, unexpired ID of the type chosen", () => {
    const { findings, flags } = judgeReading(combineReadings(clean, null), facts, TODAY, []);
    expect(flags).toEqual([]);
    expect(findings).toMatchObject({ name: "DELA CRUZ, MARIA S.", nameMatches: true, expiresOn: "2030-05-01", idKind: "senior" });
  });

  it.each([
    ["not-an-id", { ...clean, isIdCard: false }, facts],
    ["possible-edit", { ...clean, looksEdited: true, editNote: "Name pasted over" }, facts],
    ["name-mismatch", { ...clean, name: f("SANTOS, JOSE") }, facts],
    ["expired", { ...clean, expiresOn: f("2025-01-01") }, facts],
    ["type-mismatch", { ...clean, idKind: "pwd" as const }, facts],
    ["number-differs", clean, { ...facts, idNumberRead: "differs" as const }],
    ["expiry-differs", { ...clean, expiresOn: f("2031-03-15") }, { ...facts, expiryDeclared: "2032-03-15" }],
  ])("flags %s", (flag, reading, given) => {
    expect(judgeReading(combineReadings(reading, null), given, TODAY, []).flags).toEqual([flag]);
  });

  it("flags a photo like one sent from another account", () => {
    expect(judgeReading(combineReadings(clean, null), facts, TODAY, [9]).flags).toEqual(["photo-reused"]);
  });

  it("never trusts an unclear name or an impossible date, and lets OCR fill what the model left out", () => {
    const r = combineReadings({ ...clean, name: f("MARIA", true), expiresOn: f("2030-02-30") }, "Name: Maria Dela Cruz\nValid until 2031-01-15");
    expect(r).toMatchObject({ name: "Maria Dela Cruz", expiresOn: "2031-01-15" });
  });
});

describe("reading an uploaded ID in the background", () => {
  it("stores one result per check; a retry is a no-op and the model never sees the account name or number", async () => {
    const db = fakeDb();
    const model = modelReturning(clean);
    const d = deps(db, model);
    const first = await readIdPhoto(d, facts);
    expect(first).toMatchObject({ status: "read", flags: [], model: "fake" });
    expect(await readIdPhoto(d, facts)).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(1);
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).not.toContain("Maria");
    expect(prompt).not.toContain(NUMBER);
    expect(db.rows.get(5)).toMatchObject({ status: "read", flags: [] });
  });

  it("falls back to OCR when the model is down", async () => {
    const db = fakeDb();
    const result = await readIdPhoto(deps(db, failingModel(), { ocr: async () => `NAME: SANTOS, JOSE\nOSCA ID No. ${NUMBER}\nValid until 2030-01-01` }), facts);
    expect(result).toMatchObject({ status: "read", model: "tesseract.js", flags: ["name-mismatch"] });
    // The number OCR saw is never part of the stored findings.
    expect(JSON.stringify(db.rows.get(5))).not.toContain("123-456");
  });

  it("needs review when neither the model nor OCR can read the photo, or the photo is gone", async () => {
    expect(await readIdPhoto(deps(fakeDb(), failingModel(), { ocr: async () => { throw new Error("no"); } }), facts))
      .toMatchObject({ status: "needs-review", flags: ["unreadable"] });
    expect(await readIdPhoto(deps(fakeDb(), modelReturning(clean), { fetchImage: async () => { throw new Error("404"); } }), { ...facts, idNumberRead: "differs" }))
      .toMatchObject({ status: "needs-review", flags: ["number-differs"], model: null });
  });

  it("audits what was flagged under the process actor, never the number, name or photo", async () => {
    const audit = vi.fn(async (_event: unknown) => {});
    await readIdPhoto(deps(fakeDb(), modelReturning({ ...clean, idKind: "pwd" }), { audit }), facts);
    expect(audit).toHaveBeenCalledTimes(1);
    const event = audit.mock.calls[0][0];
    expect(event).toMatchObject({ action: "pwd.id_read", actor: { type: "process", id: "id-reader" }, operationId: "id-read:5", metadata: { flags: ["type-mismatch"] } });
    expect(JSON.stringify((event as { metadata: unknown }).metadata)).not.toMatch(/DELA CRUZ|123-456/);
  });

  it("sweeps waiting checks with a photo, skipping ones already read", async () => {
    const pending = [5, 6].map(id => ({ id, customer_id: `c${id}`, full_name: "Maria Dela Cruz", id_type: "senior", photo_file_id: `f${id}`, id_number_read: "matched" }));
    const db = fakeDb({ existing: [6], pending });
    expect(await readPendingIdPhotos(deps(db, modelReturning(clean)))).toEqual({ read: 1, needsReview: 0, skipped: 1 });
  });
});
