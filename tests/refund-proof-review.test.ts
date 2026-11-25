import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { approveReturn, markReturnRefunded, getReturnDetail } from "@/features/returns/actions";
import { correctRefundReading, proceedDespiteRefundFlag, saveRefundProof } from "@/features/returns/refund-proof-actions";
import { TRANSFER_VERIFIED } from "@/features/returns/refund-record";
import { reviewRefundProof } from "@/features/returns/refund-review";
import type { Findings } from "@/features/orders/proof-reader";
import { requireModule } from "@/lib/portal/staff";
import { withRefundDetails } from "./refund-details";
import { FakeFileStorage, PNG } from "./fake-file-storage";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";
import { REFUND_PROOF_SQL, REFUND_PROOF_TABLES } from "./refund-via";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const storage = new FakeFileStorage();
const audit = vi.hoisted(() => vi.fn<import("@/lib/audit-trail").AuditTrail>(async () => {}));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit, deliverGatewayAuditEvent: audit, get gatewayFileStorage() { return storage; } }));
vi.mock("@/features/files/storage", () => ({ storageUrl: (url: string) => url, directFileStorage: { view: vi.fn((id: string) => storage.view(id)) } }));
vi.mock("@/features/returns/refund-proof-start", () => ({ startRefundProofRead: vi.fn() }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: vi.fn(() => db.sql) }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));

let db: TestDatabase;
let storefront: FakeStorefront;
const manager = { id: "ana", username: "ana", name: "Ana Reyes", email: "ana@example.com", role: "CRMS Manager" };
const staffer = { id: "bea", username: "bea", name: "Bea Cruz", email: "bea@example.com", role: "Staff/Employee" };
const admin = { id: "ada", username: "ada", name: "Ada Lim", email: "ada@example.com", role: "Admin" };

const details = (staffId = "ana") => { const form = new FormData(); form.set("proof", storage.readyEvidence("Returns", PNG, staffId)); return withRefundDetails(form); };
const verified = () => { const form = new FormData(); form.set(TRANSFER_VERIFIED, "true"); return form; };
const finding = (finding: "Match" | "Mismatch" | "Missing" | "Needs Review", read: string | null, expected: string | null) => ({ finding, read, expected });
const findings = (over: Partial<Findings> = {}): Findings => ({
  amount: finding("Match", "100.00", "₱100.00"), date: finding("Match", "2026-10-23", "after 2026-10-20"), reference: finding("Match", "GC-2026-0001", "GC-2026-0001"),
  recipient: finding("Match", "MARIA SANTOS", "Maria Santos"), accountNumber: finding("Match", "09171234567", "09171234567"), ...over,
});
async function fileOf(id: number) { const [row] = await db.sql<{ proof_file_id: string }[]>`select proof_file_id from crms.refund_proof_drafts where return_id = ${id}`; return row?.proof_file_id; }
async function reader(id: number, status: "reading" | "read" | "needs-review", result: Findings | null = null) {
  const file = await fileOf(id);
  await db.sql`insert into crms.refund_proof_reads (proof_file_id, return_id, status, findings) values (${file}, ${id}, ${status}, ${result ? db.sql.json(result as never) : null})
    on conflict (proof_file_id) do update set status = excluded.status, findings = excluded.findings`;
}

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema if not exists crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-approvals.sql", "utf8"));
  for (const file of REFUND_PROOF_SQL) await db.sql.unsafe(readFileSync(file, "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql.unsafe(`truncate ${REFUND_PROOF_TABLES}`);
  await db.sql`truncate order_returns, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
  await db.sql`insert into orders (customer_id, status, delivered_at, payment_method, subtotal_in_centavos) values ('c1', 'delivered', '2026-10-20T00:00:00Z', 'gcash', 10000000)`;
  storage.reset();
  storefront = new FakeStorefront(db.sql, () => new Date("2026-10-23T08:00:00Z"), storage);
  vi.stubGlobal("fetch", storefrontFetch(storefront));
  vi.stubEnv("CREOMS_STOREFRONT_URL", FAKE_STOREFRONT_URL);
  vi.stubEnv("CREOMS_SERVICE_SECRET", FAKE_SERVICE_SECRET);
  vi.mocked(requireModule).mockResolvedValue(manager);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

async function approved() {
  const [row] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, reason, amount_in_centavos) values (1, 'damaged', 10000) returning id`;
  await approveReturn(row.id);
  return row.id;
}

describe("saving the refund proof first (#615)", () => {
  it("keeps the Return Approved and the Customer untold, stores the details and audits the save", async () => {
    const id = await approved();
    const before = storefront.requests;
    expect(await saveRefundProof(id, details())).toEqual({ ok: true });
    expect(storefront.requests).toBe(before);
    expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "approved", refundProofFileId: null } });
    expect(await db.sql`select amount_in_centavos, method, reference, saved_by_name from crms.refund_proof_drafts`).toMatchObject([{ amount_in_centavos: 10000, method: "gcash", reference: "GC-2026-0001", saved_by_name: "Ana Reyes" }]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "return.refund_proof_saved", operationId: expect.stringContaining(`return:${id}:refund_proof_saved:`) }));
    expect(storage.files.get("file-1")).toMatchObject({ returnId: id, retentionType: "temporary" });
  });

  it("lets Staff save but not include the Delivery fee, and keeps Admin read-only", async () => {
    const id = await approved();
    vi.mocked(requireModule).mockResolvedValue(staffer);
    expect(await saveRefundProof(id, details("bea"))).toEqual({ ok: true });
    vi.mocked(requireModule).mockResolvedValue(admin);
    expect(await saveRefundProof(id, details("ada"))).toMatchObject({ ok: false, reason: "Your Role can only view shop work." });
    expect(await correctRefundReading(id, "amount", "100.00", "typo")).toMatchObject({ ok: false });
  });

  it("refuses a proof for a Return that is not ready, or whose amount does not match", async () => {
    const [row] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, reason, amount_in_centavos) values (1, 'damaged', 10000) returning id`;
    expect(await saveRefundProof(row.id, details())).toMatchObject({ ok: false, reason: expect.stringContaining("not ready") });
    await approveReturn(row.id);
    const wrong = details(); wrong.set("sentAmount", "99.00");
    expect(await saveRefundProof(row.id, wrong)).toMatchObject({ ok: false, reason: expect.stringContaining("must match the refund") });
    expect(await db.sql`select 1 from crms.refund_proof_drafts`).toHaveLength(0);
  });

  it("records a refused proof save as one denied attempt with the reason and no payment details (#747)", async () => {
    const [row] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, reason, amount_in_centavos) values (1, 'damaged', 10000) returning id`;
    expect((await saveRefundProof(row.id, details())).ok).toBe(false);
    expect((await saveRefundProof(row.id, details())).ok).toBe(false);
    const denied = audit.mock.calls.map(([event]) => event).filter(event => event.action === "return.refund_proof_saved" && event.outcome === "failure");
    expect(denied).toHaveLength(2);
    expect(denied[0]).toMatchObject({ module: "Returns", target: { type: "return", id: String(row.id), display_name: `RMA-${row.id}` }, metadata: { reason: expect.stringContaining("not ready") } });
    expect(denied[1].operationId).toBe(denied[0].operationId);
    expect(JSON.stringify(denied)).not.toMatch(/GC-2026/);
  });

  it("replaces an earlier proof; the replacement is its own file with its own check", async () => {
    const id = await approved();
    await saveRefundProof(id, details());
    const first = await fileOf(id);
    await saveRefundProof(id, details());
    expect(await fileOf(id)).not.toBe(first);
    expect(await db.sql`select 1 from crms.refund_proof_drafts`).toHaveLength(1);
  });
});

describe("Mark Refunded needs the proof, the verified transfer and settled findings (#615)", () => {
  it("is refused with no saved proof, and nothing is sent to the storefront", async () => {
    const id = await approved();
    const before = storefront.requests;
    expect(await markReturnRefunded(id, verified())).toMatchObject({ ok: false, reason: expect.stringContaining("Save the refund proof") });
    expect(storefront.requests).toBe(before);
  });

  it("is refused until Staff confirm they verified the real transfer", async () => {
    const id = await approved();
    await saveRefundProof(id, details()); await reader(id, "read", findings());
    expect(await markReturnRefunded(id, new FormData())).toMatchObject({ ok: false, reason: expect.stringContaining("Verify the real transfer") });
    expect(await markReturnRefunded(id, undefined)).toMatchObject({ ok: false });
  });

  it("waits while the Proof reader is still reading, and is not blocked by a failed read", async () => {
    const id = await approved();
    await saveRefundProof(id, details());
    expect(await markReturnRefunded(id, verified())).toMatchObject({ ok: false, reason: expect.stringContaining("still checking") });
    await reader(id, "reading");
    expect(await markReturnRefunded(id, verified())).toMatchObject({ ok: false, reason: expect.stringContaining("still checking") });
    await reader(id, "needs-review");
    expect(await markReturnRefunded(id, verified())).toMatchObject({ ok: true, return: { status: "refunded" } });
  });

  it("is refused while a detail is flagged, then allowed after a correction that matches or a recorded reason to proceed", async () => {
    const id = await approved();
    await saveRefundProof(id, details());
    await reader(id, "read", findings({ amount: finding("Mismatch", "90.00", "₱100.00"), reference: finding("Missing", null, "GC-2026-0001") }));
    expect(await markReturnRefunded(id, verified())).toMatchObject({ ok: false, reason: "Correct or proceed past the flagged details first: amount, reference." });
    expect(await correctRefundReading(id, "amount", "100.00", "The receipt was cropped")).toEqual({ ok: true });
    expect(await markReturnRefunded(id, verified())).toMatchObject({ ok: false, reason: "Correct or proceed past the flagged details first: reference." });
    expect(await proceedDespiteRefundFlag(id, "reference", "Bank receipts hide the reference")).toEqual({ ok: true });
    expect(await markReturnRefunded(id, verified())).toMatchObject({ ok: true, return: { status: "refunded" } });
  });

  it("keeps the original reading and audits each correction and decision with who made it and why", async () => {
    const id = await approved();
    await saveRefundProof(id, details());
    await reader(id, "read", findings({ amount: finding("Mismatch", "90.00", "₱100.00"), reference: finding("Missing", null, "GC-2026-0001") }));
    await correctRefundReading(id, "amount", "100.00", "The receipt was cropped");
    await proceedDespiteRefundFlag(id, "reference", "Bank receipts hide the reference");
    const [stored] = await db.sql<{ findings: Findings }[]>`select findings from crms.refund_proof_reads`;
    expect(stored.findings.amount).toEqual(finding("Mismatch", "90.00", "₱100.00"));
    expect(await db.sql`select kind, field, original_value, corrected_value, original_finding, reason, by_name from crms.refund_proof_corrections order by id`).toMatchObject([
      { kind: "correction", field: "amount", original_value: "90.00", corrected_value: "100.00", original_finding: "Mismatch", reason: "The receipt was cropped", by_name: "Ana Reyes" },
      { kind: "override", field: "reference", original_value: null, corrected_value: null, original_finding: "Missing", reason: "Bank receipts hide the reference", by_name: "Ana Reyes" },
    ]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_proof.corrected", description: expect.stringContaining("The receipt was cropped") }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_proof.flag_overridden", description: expect.stringContaining("Bank receipts hide the reference") }));
    audit.mockClear();
    await markReturnRefunded(id, verified());
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "return.refund_approved", metadata: expect.objectContaining({ transferVerified: true,
      proofChanges: [expect.objectContaining({ kind: "correction", field: "amount", correctedValue: "100.00", originalValue: "90.00" }), expect.objectContaining({ kind: "override", field: "reference" })] }) }));
  });

  it("refuses a correction with no reason, for a detail with no flag, before the reader has run, or after Refunded", async () => {
    const id = await approved();
    expect(await correctRefundReading(id, "amount", "100.00", "typo")).toMatchObject({ ok: false, reason: "Save the refund proof first." });
    await saveRefundProof(id, details());
    expect(await correctRefundReading(id, "amount", "100.00", "typo")).toMatchObject({ ok: false, reason: "The Proof reader has not read this proof yet." });
    await reader(id, "read", findings());
    expect(await correctRefundReading(id, "amount", "100.00", " ")).toMatchObject({ ok: false, reason: "Enter a reason for the correction." });
    expect(await proceedDespiteRefundFlag(id, "amount", "ok")).toMatchObject({ ok: false, reason: "That detail has no flag to proceed past." });
    expect(await correctRefundReading(id, "colour", "x", "y")).toMatchObject({ ok: false, reason: "Unknown detail." });
    expect(await markReturnRefunded(id, verified())).toMatchObject({ ok: true });
    expect(await correctRefundReading(id, "amount", "1.00", "late")).toMatchObject({ ok: false, reason: "This Return is already Refunded." });
  });

  it("a correction that still mismatches does not clear the flag", async () => {
    const id = await approved();
    await saveRefundProof(id, details()); await reader(id, "read", findings({ amount: finding("Mismatch", "90.00", "₱100.00") }));
    await correctRefundReading(id, "amount", "95.00", "second look");
    expect(await markReturnRefunded(id, verified())).toMatchObject({ ok: false, reason: expect.stringContaining("amount") });
  });
});

describe("reviewRefundProof", () => {
  const read = (status: "pending" | "reading" | "read" | "needs-review", f: Findings | null = null) => ({ status, findings: f });
  it("counts a proof saved moments ago with no result as still being read, and an old one as unread", () => {
    const now = new Date("2026-10-23T08:00:00Z");
    expect(reviewRefundProof(null, [], new Date("2026-10-23T07:59:30Z"), now)).toEqual({ reading: true, unresolved: [] });
    expect(reviewRefundProof(read("pending"), [], new Date("2026-10-23T07:00:00Z"), now)).toEqual({ reading: false, unresolved: [] });
  });
  it("never blocks a failed read, and lists every unsettled flag otherwise", () => {
    expect(reviewRefundProof(read("needs-review"), [])).toEqual({ reading: false, unresolved: [] });
    expect(reviewRefundProof(read("read", findings({ date: finding("Needs Review", "2026-1", "after 2026-10-20") })), []).unresolved).toEqual(["date"]);
    expect(reviewRefundProof(read("read", findings()), []).unresolved).toEqual([]);
  });
});
