import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withRefundDetails } from "./refund-details";
import { approveReturn, getReturnDetail, markReturnRefunded } from "@/features/returns/actions";
import { checkRefundRecord, REFUND_FIELDS, returnLabel, todayInManila } from "@/features/returns/refund-record";
import { requireModule } from "@/lib/portal/staff";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";
import { refundVia, REFUND_PROOF_SQL, REFUND_PROOF_TABLES } from "./refund-via";
import { startTestDatabase, type TestDatabase } from "./ticket-database";
import { FakeFileStorage, PNG } from "./fake-file-storage";

const storage = new FakeFileStorage();
const audit = vi.hoisted(() => vi.fn<import("@/lib/audit-trail").AuditTrail>(async () => {}));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit, deliverGatewayAuditEvent: audit, get gatewayFileStorage() { return storage; } }));
vi.mock("@/features/files/storage", () => ({ storageUrl: (url: string) => url, directFileStorage: { view: vi.fn((id: string) => storage.view(id)) } }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: vi.fn() }));
vi.mock("@/features/returns/refund-proof-start", () => ({ startRefundProofRead: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: vi.fn(() => db.sql) }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));

let db: TestDatabase;
let storefront: FakeStorefront;
const manager = { id: "ana", username: "ana", name: "Ana Reyes", email: "ana@example.com", role: "CRMS Manager" };

describe("the refund record rules (#613)", () => {
  const requestedAt = new Date("2026-10-20T00:00:00Z");
  const now = new Date("2026-10-23T08:00:00Z");
  const check = (fields: Record<string, string>, destinationMethod: string | null = null) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ [REFUND_FIELDS.amount]: "1,250.50", [REFUND_FIELDS.method]: "maya", [REFUND_FIELDS.date]: "2026-10-22", [REFUND_FIELDS.reference]: "MAYA-77", ...fields })) form.set(key, value);
    return checkRefundRecord(form, { expectedInCentavos: 125050, destinationMethod, requestedAt, now });
  };

  it("accepts the amount, method, date and reference, and cleans them", () => {
    expect(check({ [REFUND_FIELDS.reference]: "  MAYA-77  " })).toEqual({ ok: true, record: { amountInCentavos: 125050, method: "maya", refundedOn: "2026-10-22", reference: "MAYA-77" } });
  });

  it("refuses each missing or wrong detail with its own reason", () => {
    expect(check({ [REFUND_FIELDS.amount]: "" })).toMatchObject({ ok: false, reason: "Enter the amount sent, in pesos." });
    expect(check({ [REFUND_FIELDS.amount]: "1250.00" })).toMatchObject({ ok: false, reason: expect.stringContaining("must match the refund") });
    expect(check({ [REFUND_FIELDS.method]: "cash" })).toMatchObject({ ok: false, reason: expect.stringContaining("Choose how the refund was sent") });
    expect(check({ [REFUND_FIELDS.date]: "2026-02-30" })).toMatchObject({ ok: false, reason: "Enter the date the refund was sent." });
    expect(check({ [REFUND_FIELDS.date]: "2026-10-25" })).toMatchObject({ ok: false, reason: "The refund date cannot be in the future." });
    expect(check({ [REFUND_FIELDS.date]: "2026-10-19" })).toMatchObject({ ok: false, reason: "The refund date cannot be before the Return was requested." });
    for (const reference of ["", "abc", "x".repeat(101), "<script>"]) expect(check({ [REFUND_FIELDS.reference]: reference })).toMatchObject({ ok: false, reason: expect.stringContaining("reference") });
  });

  it("holds the method to the one the Customer confirmed", () => {
    expect(check({}, "gcash")).toMatchObject({ ok: false, reason: expect.stringContaining("Customer confirmed GCash") });
    expect(check({}, "maya")).toMatchObject({ ok: true });
  });

  it("labels the stored statuses without changing them", () => {
    expect([returnLabel("requested"), returnLabel("declined"), returnLabel("approved", true), returnLabel("goods received"), returnLabel("refunded")])
      .toEqual(["Pending Review", "Rejected", "Awaiting Return", "Returned", "Refunded"]);
    expect(returnLabel("approved", false)).toBe("Returned");
  });
});

describe("Mark Refunded records the details (#613)", () => {
  beforeAll(async () => { db = await startTestDatabase(); await db.sql`create schema if not exists crms`; await db.sql.unsafe(readFileSync("docs/db/crms-approvals.sql", "utf8")); for (const file of REFUND_PROOF_SQL) await db.sql.unsafe(readFileSync(file, "utf8")); }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
  await db.sql.unsafe(`truncate ${REFUND_PROOF_TABLES}`);
    await db.sql`truncate order_returns, orders, customers restart identity cascade`;
    await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
    await db.sql`insert into orders (customer_id, status, delivered_at, payment_method, subtotal_in_centavos) values ('c1', 'delivered', '2026-10-20T00:00:00Z', 'gcash', 10000000)`;
    storage.reset();
    storefront = new FakeStorefront(db.sql, () => new Date(), storage);
    vi.stubGlobal("fetch", storefrontFetch(storefront));
    vi.stubEnv("CREOMS_STOREFRONT_URL", FAKE_STOREFRONT_URL);
    vi.stubEnv("CREOMS_SERVICE_SECRET", FAKE_SERVICE_SECRET);
    vi.mocked(requireModule).mockResolvedValue(manager);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

  async function approved() {
    const [row] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, reason, amount_in_centavos) values (1, 'damaged', 25000) returning id`;
    expect(await approveReturn(row.id)).toMatchObject({ ok: true });
    return row.id;
  }
  const proof = () => { const form = new FormData(); form.set("proof", storage.readyEvidence("Returns", PNG, "ana")); return form; };
  const stored = async (id: number) => (await db.sql`select status, refund_amount_in_centavos as amount, refund_paid_method as method, refund_paid_on::text as on, refund_reference as reference from order_returns where id = ${id}`)[0];

  it("refuses until every detail and the proof exist, and contacts the storefront for none of them", async () => {
    const id = await approved();
    const requests = storefront.requests;
    expect(await refundVia(db.sql, id, proof())).toMatchObject({ ok: false, reason: "Enter the amount sent, in pesos." });
    for (const missing of Object.values(REFUND_FIELDS)) {
      const form = withRefundDetails(proof(), { amount: "250.00" });
      form.delete(missing);
      expect(await refundVia(db.sql, id, form)).toMatchObject({ ok: false });
    }
    const noProof = withRefundDetails(new FormData(), { amount: "250.00" });
    expect(await refundVia(db.sql, id, noProof)).toEqual({ ok: false, reason: "Choose exactly one refund proof screenshot." });
    expect(storefront.requests).toBe(requests);
    expect(await stored(id)).toMatchObject({ status: "approved", amount: null, reference: null });
  });

  it("refuses an amount that is not the refund, and a method other than the Customer's confirmed one", async () => {
    const id = await approved();
    const requests = storefront.requests;
    expect(await refundVia(db.sql, id, withRefundDetails(proof(), { amount: "249.00" }))).toMatchObject({ ok: false, reason: expect.stringContaining("must match the refund") });
    await db.sql`update order_returns set refund_method = 'maya' where id = ${id}`;
    expect(await refundVia(db.sql, id, withRefundDetails(proof(), { amount: "250.00", via: "gcash" }))).toMatchObject({ ok: false, reason: expect.stringContaining("Customer confirmed Maya") });
    expect(storefront.requests).toBe(requests);
  });

  it("saves the details with the status, shows them on the Return and audits them", async () => {
    const id = await approved();
    expect(await refundVia(db.sql, id, withRefundDetails(proof(), { amount: "250.00", via: "gcash", reference: "GC-9981" }))).toMatchObject({ ok: true });
    expect(await stored(id)).toEqual({ status: "refunded", amount: 25000, method: "gcash", on: todayInManila(), reference: "GC-9981" });
    expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { refundRecord: { amountInCentavos: 25000, method: "gcash", refundedOn: todayInManila(), reference: "GC-9981" } } });
    expect(audit.mock.calls.at(-1)![0]).toMatchObject({ action: "return.refund_approved", metadata: { amountInCentavos: 25000, method: "gcash", reference: "GC-9981" } });
  });

  it("does not trust a storefront answer that records different details", async () => {
    const id = await approved();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id, status: "refunded", refundProofFileId: "file-1", refundAmountInCentavos: 1, refundPaidMethod: "gcash", refundedOn: todayInManila(), refundReference: "GC-9981", actedBy: { id: "ana", name: "Ana Reyes", at: new Date().toISOString() } })));
    expect(await refundVia(db.sql, id, withRefundDetails(proof(), { amount: "250.00", reference: "GC-9981" }))).toMatchObject({ ok: false, reason: expect.stringContaining("Refresh the Return") });
  });
});
