import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import sharp from "sharp";

import { compareReading, mergeReadings, ocrReading, readProof, readPendingProofs, type ProofFacts, type ModelReading, type ReaderDeps } from "@/features/orders/proof-reader";

const facts: ProofFacts = {
  proofId: 7, orderId: 40, fileId: "f7", reference: "REF 123", totalInCentavos: 150_000,
  orderPlacedAt: new Date("2026-11-10T02:00:00Z"), accountName: "Juan Dela Cruz", accountNumber: "0917 123 4567",
};
const f = (value: string | null, unclear = false) => ({ value, unclear });
const clean: ModelReading = {
  amount: f("1,500.00"), date: f("2026-11-11"), reference: f("ref123"), recipient: f("JUAN DELA CRUZ"), accountNumber: f("09171234567"),
};

/** A recording stand-in for the two databases: it keeps the proof_reads rows and answers by statement text. */
function fakeDb(opts: { existing?: number[]; others?: { id: number; order_id: number; file: string }[]; sibling?: { proof_id: number; image_fingerprint: string }[]; refOrders?: number[] } = {}) {
  const rows = new Map<number, Record<string, unknown>>((opts.existing ?? []).map(id => [id, { status: "read" }]));
  const crms = Object.assign(async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?");
    if (q.includes("insert into crms.payment_proof_reads")) { if (rows.has(v[0] as number)) return []; rows.set(v[0] as number, { status: "reading" }); return [{ proof_id: v[0] }]; }
    if (q.includes("update crms.payment_proof_reads set status = 'needs-review'")) return [];
    if (q.startsWith("update crms.payment_proof_reads")) { rows.set(v.at(-1) as number, { status: v[0], findings: v[1], flags: v[2], fingerprint: v[3], model: v[4] }); return []; }
    if (q.includes("select proof_id from")) return [...rows.keys()].map(proof_id => ({ proof_id }));
    if (q.includes("image_fingerprint from")) return opts.sibling ?? [];
    throw new Error(`unexpected crms sql: ${q}`);
  }, { json: (x: unknown) => x });
  const storefront = async (strings: TemplateStringsArray) => {
    const q = strings.join("?");
    if (q.includes("distinct o.id")) return (opts.refOrders ?? []).map(id => ({ id }));
    if (q.includes("order_payment_proofs p join")) return (opts.others ?? []).map(o => ({ ...o, reference: "R", total: 150_000, created_at: new Date("2026-11-10"), account_name: "Juan", account_number: "1" }));
    throw new Error(`unexpected storefront sql: ${q}`);
  };
  return { rows, crms: crms as never, storefront: storefront as never };
}
const modelReturning = (json: unknown) => new MockLanguageModelV4({ doGenerate: async () => ({
  content: [{ type: "text", text: JSON.stringify(json) }], finishReason: { unified: "stop", raw: undefined },
  usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } }, warnings: [],
}) });
const png = () => sharp({ create: { width: 40, height: 40, channels: 3, background: "#456" } }).png().toBuffer();
const deps = (db: ReturnType<typeof fakeDb>, model: MockLanguageModelV4, extra: Partial<ReaderDeps> = {}): ReaderDeps => ({
  crms: db.crms, storefront: db.storefront, models: [{ name: "fake", model }], fetchImage: async () => png(), ocr: async () => "", audit: vi.fn(async () => {}), ...extra,
});

describe("comparing what the Proof reader saw", () => {
  it("matches clean readings, ignoring case, spaces and thousands separators", () => {
    const r = compareReading(clean, facts);
    expect(Object.values(r).map(x => x.finding)).toEqual(["Match", "Match", "Match", "Match", "Match"]);
  });
  it("flags real mismatches", () => {
    const r = compareReading({ ...clean, amount: f("1,400.00"), recipient: f("Maria Santos"), date: f("2026-11-01") }, facts);
    expect([r.amount.finding, r.recipient.finding, r.date.finding]).toEqual(["Mismatch", "Mismatch", "Mismatch"]);
  });
  it("never assumes a Match for a masked, unclear or unparseable field, and reports a hidden one as Missing", () => {
    const r = compareReading({ ...clean, reference: f("REF 123", true), amount: f("about fifteen hundred"), recipient: f(null) }, facts);
    expect(r.reference.finding).toBe("Needs Review");
    expect(r.amount.finding).toBe("Needs Review");
    expect(r.recipient.finding).toBe("Missing");
  });
});

it("compares only the last four digits of the account number", () => {
  const judge = (v: string | null, unclear = false) => compareReading({ ...clean, accountNumber: { value: v, unclear } }, facts).accountNumber.finding;
  expect(judge("0917 *** 4567")).toBe("Match");
  expect(judge("********4567")).toBe("Match");
  expect(judge("0917 *** 9999")).toBe("Mismatch");
  expect(judge("09** *** **")).toBe("Needs Review");
  expect(judge("****4567", true)).toBe("Needs Review");
  expect(judge(null)).toBe("Missing");
});
it("reads the last four digits of a masked account number from OCR", () => {
  expect(ocrReading("Sent to 09** *** 4567 Ref No. 1234").accountNumber.value).toMatch(/4567$/);
  expect(ocrReading("nothing here").accountNumber.value).toBeNull();
});

describe("reading one proof", () => {
  it("stores one result with findings and audits it, changing nothing else", async () => {
    const db = fakeDb(); const d = deps(db, modelReturning(clean));
    const result = await readProof(d, facts);
    expect(result?.status).toBe("read");
    expect(db.rows.get(7)?.status).toBe("read");
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "payment_proof.read", outcome: "success", actor: expect.objectContaining({ type: "process" }) }));
  });
  it("sends the model only the image and a fixed instruction, none of the Order's or Customer's facts", async () => {
    const model = modelReturning(clean);
    await readProof(deps(fakeDb(), model), facts);
    const sent = JSON.stringify(model.doGenerateCalls[0].prompt);
    for (const secret of ["REF 123", "Juan Dela Cruz", "0917", "150000", "1500"]) expect(sent).not.toContain(secret);
    expect(model.doGenerateCalls[0].prompt.some(m => m.role === "user" && Array.isArray(m.content) && m.content.some(c => c.type === "file"))).toBe(true);
  });
  it("makes no second record when the proof already has its result, and never calls the model", async () => {
    const db = fakeDb({ existing: [7] }); const model = modelReturning(clean);
    expect(await readProof(deps(db, model), facts)).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
  });
  it("stores Needs Review when the model fails", async () => {
    const down = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("down"); } });
    const db = fakeDb(); const d = deps(db, down);
    const result = await readProof(d, facts);
    expect(result?.status).toBe("needs-review");
    expect(Object.values(result!.findings).every(x => x.finding === "Needs Review")).toBe(true);
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure" }));
  });
  it("falls back to the OCR text when the model is down, and flags a ₱90 receipt on a ₱900 Order", async () => {
    const down = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("down"); } });
    const text = "Total Amount Sent P90.00\nRef No. 0046 996 384770\nNov 07, 2026 6:04 PM";
    const result = await readProof(deps(fakeDb(), down, { ocr: async () => text }), { ...facts, totalInCentavos: 90_000 });
    expect(result?.status).toBe("read");
    expect(result?.model).toBe("tesseract.js");
    expect(result?.findings.amount).toMatchObject({ finding: "Mismatch", read: "90.00" });
    expect(result?.findings.recipient.finding).toBe("Needs Review");
  });
  it("lets OCR fill a detail the model could not find", () => {
    const merged = mergeReadings({ ...clean, amount: { value: null, unclear: false } }, ocrReading("Amount Sent P900.00"));
    expect(merged.amount.value).toBe("900.00");
  });
  it("stores Needs Review when the image cannot be fetched", async () => {
    const result = await readProof(deps(fakeDb(), modelReturning(clean), { fetchImage: async () => { throw new Error("gone"); } }), facts);
    expect(result?.status).toBe("needs-review");
  });
  it("flags a reference used on another Order and a similar image on another proof, without blocking", async () => {
    const { fingerprintImage } = await import("@/features/returns/image-fingerprint");
    const db = fakeDb({ refOrders: [12], sibling: [{ proof_id: 3, image_fingerprint: await fingerprintImage(await png()) }] });
    const result = await readProof(deps(db, modelReturning(clean)), facts);
    expect(result?.flags).toEqual({ reusedReferenceOrderIds: [12], reusedImageProofIds: [3] });
    expect(result?.status).toBe("read");
  });
});

describe("the background sweep", () => {
  it("reads each proof once, so running it twice makes no second record", async () => {
    const db = fakeDb({ others: [{ id: 7, order_id: 40, file: "f7" }, { id: 8, order_id: 41, file: "f8" }] });
    const model = modelReturning(clean);
    expect(await readPendingProofs(deps(db, model))).toEqual({ read: 2, needsReview: 0, skipped: 0 });
    expect(await readPendingProofs(deps(db, model))).toEqual({ read: 0, needsReview: 0, skipped: 2 });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(db.rows.size).toBe(2);
  });
});
