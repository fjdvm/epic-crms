import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import sharp from "sharp";

import { readRefundProof, readPendingRefundProofs, refundProofReadFor, type RefundProofFacts, type RefundReaderDeps } from "@/features/returns/refund-proof-reader";
import type { ModelReading } from "@/features/orders/proof-reader";

const facts: RefundProofFacts = {
  returnId: 5, orderId: 40, fileId: "rf5", expectedInCentavos: 120_000, requestedAt: new Date("2026-11-10T02:00:00Z"),
  reference: "REF-9001", destinationName: "Juan Dela Cruz", destinationNumber: "0917 123 4567",
};
const f = (value: string | null, unclear = false) => ({ value, unclear });
const clean: ModelReading = { amount: f("1,200.00"), date: f("2026-11-12"), reference: f("ref9001"), recipient: f("JUAN DELA CRUZ"), accountNumber: f("09171234567") };

function fakeDb(opts: { existing?: string[]; pending?: { id: number; file: string }[] } = {}) {
  const rows = new Map<string, Record<string, unknown>>((opts.existing ?? []).map(id => [id, { status: "read" }]));
  const crms = Object.assign(async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?");
    if (q.includes("insert into crms.refund_proof_reads")) { if (rows.has(v[0] as string)) return []; rows.set(v[0] as string, { status: "reading" }); return [{ proof_file_id: v[0] }]; }
    if (q.includes("update crms.refund_proof_reads set status = 'needs-review'")) return [];
    if (q.startsWith("update crms.refund_proof_reads")) { rows.set(v.at(-1) as string, { status: v[0], findings: v[1], model: v[2] }); return []; }
    if (q.includes("select proof_file_id from")) return [...rows.keys()].map(proof_file_id => ({ proof_file_id }));
    if (q.includes("select status, findings")) { const r = rows.get(v[0] as string); return r ? [r] : []; }
    throw new Error(`unexpected crms sql: ${q}`);
  }, { json: (x: unknown) => x });
  const storefront = async (strings: TemplateStringsArray) => {
    if (!strings.join("?").includes("public.order_returns r")) throw new Error("unexpected storefront sql");
    return (opts.pending ?? []).map(p => ({ id: p.id, order_id: 40, file: p.file, amount: 100_000, fee: 20_000, paid: null, requested_at: new Date("2026-11-10"), reference: "REF-9001", dest_name: "Juan Dela Cruz", dest_number: "09171234567" }));
  };
  return { rows, crms: crms as never, storefront: storefront as never };
}
const model = (json: unknown) => new MockLanguageModelV4({ doGenerate: async () => ({
  content: [{ type: "text", text: JSON.stringify(json) }], finishReason: { unified: "stop", raw: undefined },
  usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } }, warnings: [],
}) });
const png = () => sharp({ create: { width: 40, height: 40, channels: 3, background: "#456" } }).png().toBuffer();
const deps = (db: ReturnType<typeof fakeDb>, m: MockLanguageModelV4, extra: Partial<RefundReaderDeps> = {}): RefundReaderDeps => ({
  crms: db.crms, storefront: db.storefront, models: [{ name: "fake", model: m }], fetchImage: async () => png(), audit: vi.fn(async () => {}), ...extra,
});

describe("reading a refund proof", () => {
  it("compares with the approved refund amount and confirmed destination, stores one result and audits it", async () => {
    const db = fakeDb(); const d = deps(db, model(clean));
    const r = await readRefundProof(d, facts);
    expect(r?.status).toBe("read");
    expect(Object.values(r!.findings).map(x => x.finding)).toEqual(["Match", "Match", "Match", "Match", "Match"]);
    expect(db.rows.get("rf5")?.status).toBe("read");
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_proof.read", outcome: "success", actor: expect.objectContaining({ type: "process" }) }));
  });
  it("flags a wrong amount, and treats masked or hidden details as Needs Review or Missing, never Match", async () => {
    const r = await readRefundProof(deps(fakeDb(), model({ ...clean, amount: f("1,000.00"), accountNumber: f("0917 *** 4567"), recipient: f(null) })), facts);
    expect([r!.findings.amount.finding, r!.findings.accountNumber.finding, r!.findings.recipient.finding]).toEqual(["Mismatch", "Needs Review", "Missing"]);
  });
  it("sends only the image to the model, none of the refund or destination details", async () => {
    const m = model(clean);
    await readRefundProof(deps(fakeDb(), m), facts);
    const sent = JSON.stringify(m.doGenerateCalls[0].prompt);
    for (const secret of ["REF-9001", "Juan Dela Cruz", "0917", "120000", "1200"]) expect(sent).not.toContain(secret);
  });
  it("makes no second record and never calls the model when the proof already has a result", async () => {
    const m = model(clean);
    expect(await readRefundProof(deps(fakeDb({ existing: ["rf5"] }), m), facts)).toBeNull();
    expect(m.doGenerateCalls).toHaveLength(0);
  });
  it("stores Needs Review when the model fails or the image is gone", async () => {
    const down = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("down"); } });
    const a = await readRefundProof(deps(fakeDb(), down), facts);
    const b = await readRefundProof(deps(fakeDb(), model(clean), { fetchImage: async () => { throw new Error("gone"); } }), facts);
    expect([a?.status, b?.status]).toEqual(["needs-review", "needs-review"]);
    expect(Object.values(a!.findings).every(x => x.finding === "Needs Review")).toBe(true);
  });
  it("only writes findings: no statement touches a Return, an Order or a payment", async () => {
    const seen: string[] = [];
    const db = fakeDb();
    const spy = Object.assign(async (s: TemplateStringsArray, ...v: unknown[]) => { seen.push(s.join("?")); return (db.crms as never as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(s, ...v); }, { json: (x: unknown) => x });
    await readRefundProof(deps(db, model(clean), { crms: spy as never }), facts);
    expect(seen.every(q => q.includes("crms.refund_proof_reads"))).toBe(true);
  });
});

describe("the sweep and the view", () => {
  it("reads each refund proof once: a second run skips it", async () => {
    const db = fakeDb({ pending: [{ id: 5, file: "rf5" }, { id: 6, file: "rf6" }] }); const m = model(clean);
    expect(await readPendingRefundProofs(deps(db, m))).toEqual({ read: 2, needsReview: 0, skipped: 0 });
    expect(await readPendingRefundProofs(deps(db, m))).toEqual({ read: 0, needsReview: 0, skipped: 2 });
    expect(m.doGenerateCalls).toHaveLength(2);
  });
  it("expects the items plus the included Delivery fee when no paid amount is recorded", async () => {
    const db = fakeDb({ pending: [{ id: 5, file: "rf5" }] });
    await readPendingRefundProofs(deps(db, model(clean)));
    expect((db.rows.get("rf5")!.findings as { amount: { expected: string } }).amount.expected).toContain("1,200.00");
  });
  it("shows pending when there is no result, the stored result when there is one, and nothing when the read fails; it never calls the model", async () => {
    const m = model(clean); const db = fakeDb();
    expect(await refundProofReadFor(db.crms, null)).toBeNull();
    expect(await refundProofReadFor(db.crms, "rf5")).toEqual({ status: "pending", findings: null });
    await readRefundProof(deps(db, m), facts);
    expect((await refundProofReadFor(db.crms, "rf5"))?.status).toBe("read");
    expect(m.doGenerateCalls).toHaveLength(1);
    const broken = (async () => { throw new Error("db down"); }) as never;
    expect(await refundProofReadFor(broken, "rf5")).toBeNull();
  });
});
