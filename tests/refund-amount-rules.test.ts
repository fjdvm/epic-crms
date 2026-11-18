import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withRefundDetails } from "./refund-details";
import { approveReturn, getReturnDetail, markReturnRefunded } from "@/features/returns/actions";
import { requireModule } from "@/lib/portal/staff";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";
import { startTestDatabase, type TestDatabase } from "./ticket-database";
import { FakeFileStorage, PNG } from "./fake-file-storage";

const storage = new FakeFileStorage();
const audit = vi.hoisted(() => vi.fn<import("@/lib/audit-trail").AuditTrail>(async () => {}));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit, get gatewayFileStorage() { return storage; } }));
vi.mock("@/features/files/storage", () => ({ storageUrl: (url: string) => url, directFileStorage: { view: vi.fn((id: string) => storage.view(id)) } }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: vi.fn(() => db.sql) }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));

let db: TestDatabase;
let storefront: FakeStorefront;
const manager = { id: "ana", username: "ana", name: "Ana Reyes", email: "ana@example.com", role: "CRMS Manager" };
const staffer = { id: "bea", username: "bea", name: "Bea Cruz", email: "bea@example.com", role: "Staff/Employee" };
/** The proof and, when `pesos` is given, the details Staff record with the refund (#613). */
function proof(staffId = "ana", pesos?: string) {
  const form = new FormData();
  form.set("proof", storage.readyEvidence("Returns", PNG, staffId));
  return pesos ? withRefundDetails(form, { amount: pesos }) : form;
}
function withFee(form: FormData, reason = "Shop sent the wrong flavour") {
  form.set("includeDeliveryFee", "true"); form.set("deliveryFeeReason", reason);
  return form;
}

beforeAll(async () => { db = await startTestDatabase(); await db.sql`create schema if not exists crms`; await db.sql.unsafe(readFileSync("docs/db/crms-approvals.sql", "utf8")); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate order_returns, orders, customers restart identity cascade`;
  await db.sql`update crms.approval_settings set limit_in_centavos = 500000`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
  // Paid by GCash: items 100000, Senior/PWD discount 10000, Delivery fee 15000, total 105000.
  await db.sql`insert into orders (customer_id, status, delivered_at, payment_method, subtotal_in_centavos, approved_discount_in_centavos, delivery_fee_in_centavos, total_in_centavos)
    values ('c1', 'delivered', '2026-10-20T00:00:00Z', 'gcash', 100000, 10000, 15000, 105000)`;
  storage.reset();
  storefront = new FakeStorefront(db.sql, () => new Date("2026-10-23T08:00:00Z"), storage);
  vi.stubGlobal("fetch", storefrontFetch(storefront));
  vi.stubEnv("CREOMS_STOREFRONT_URL", FAKE_STOREFRONT_URL);
  vi.stubEnv("CREOMS_SERVICE_SECRET", FAKE_SERVICE_SECRET);
  vi.mocked(requireModule).mockResolvedValue(manager);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

async function approved(reason: string, amount: number) {
  const [row] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, reason, amount_in_centavos) values (1, ${reason}, ${amount}) returning id`;
  const [line] = await db.sql<{ id: number }[]>`insert into order_lines (order_id, product_name, size_label, price_in_centavos, quantity) values (1, 'Halaya tub', 'L', ${amount}, 1) returning id`;
  await db.sql`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos) values (${row.id}, ${line.id}, 'Halaya tub', 'L', 1, ${amount})`;
  const result = await approveReturn(row.id);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return row.id;
}
const feeOf = async (id: number) => (await db.sql`select refund_delivery_fee_in_centavos as fee, refund_delivery_fee_reason as reason from order_returns where id = ${id}`)[0];

describe("refund amount rules (#611)", () => {
  it("refunds the items only by default, with no Delivery fee", async () => {
    const id = await approved("wrong item", 40000);
    expect(await markReturnRefunded(id, proof("ana", "400.00"))).toMatchObject({ ok: true });
    expect(await feeOf(id)).toEqual({ fee: null, reason: null });
    expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { amount: 40000, deliveryFeeRefunded: 0 } });
  });

  it("lets a Manager include the Delivery fee for a wrong item, and records it separately with the reason", async () => {
    const id = await approved("wrong item", 40000);
    expect(await markReturnRefunded(id, withFee(proof("ana", "550.00")))).toMatchObject({ ok: true });
    expect(await feeOf(id)).toEqual({ fee: 15000, reason: "Shop sent the wrong flavour" });
    expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { amount: 40000, deliveryFeeRefunded: 15000 } });
    expect(audit.mock.calls.at(-1)![0]).toMatchObject({ action: "return.refund_approved", metadata: { itemsInCentavos: 40000, deliveryFeeIncluded: true, deliveryFeeInCentavos: 15000, deliveryFeeReason: "Shop sent the wrong flavour" } });
  });

  it("refuses the Delivery fee for Staff, without a reason, for another reason, or twice on one Order", async () => {
    const first = await approved("defective", 30000);
    vi.mocked(requireModule).mockResolvedValue(staffer);
    expect(await markReturnRefunded(first, withFee(proof("bea")))).toEqual({ ok: false, reason: "Only a Manager can include the Delivery fee in a refund." });
    vi.mocked(requireModule).mockResolvedValue(manager);
    expect(await markReturnRefunded(first, withFee(proof(), " "))).toEqual({ ok: false, reason: "Enter a reason for refunding the Delivery fee." });
    const other = await approved("other", 10000);
    expect(await markReturnRefunded(other, withFee(proof()))).toEqual({ ok: false, reason: "The Delivery fee is refunded only for a wrong or defective item." });
    expect(await markReturnRefunded(first, withFee(proof("ana", "450.00")))).toMatchObject({ ok: true });
    const second = await approved("defective", 20000);
    expect(await markReturnRefunded(second, withFee(proof()))).toEqual({ ok: false, reason: "The Delivery fee was already refunded on this Order." });
    expect(await markReturnRefunded(second, proof("ana", "200.00"))).toMatchObject({ ok: true });
  });

  it("says when the Delivery fee can be offered", async () => {
    const id = await approved("defective", 30000);
    expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { orderDeliveryFee: 15000, deliveryFeeRefundable: true } });
    await db.sql`update orders set delivery_fee_in_centavos = 0 where id = 1`;
    expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { deliveryFeeRefundable: false } });
  });

  it("never lets cumulative refunds pass what was paid, and blocks a second refund of the same Return", async () => {
    const first = await approved("other", 100000);
    expect(await markReturnRefunded(first, proof("ana", "1000.00"))).toMatchObject({ ok: true });
    expect(await markReturnRefunded(first, proof("ana", "1000.00"))).toMatchObject({ ok: false });
    const second = await approved("other", 20000);
    expect(await markReturnRefunded(second, proof())).toEqual({ ok: false, reason: "Refunds on this Order cannot add up to more than the Customer paid." });
  });

  it("refunds Cash on Delivery only after the cash was collected", async () => {
    await db.sql`update orders set payment_method = 'cash-on-delivery' where id = 1`;
    const id = await approved("other", 10000);
    expect(await markReturnRefunded(id, proof())).toEqual({ ok: false, reason: "No cash was collected on this Cash on Delivery Order, so there is nothing to refund." });
    await db.sql`update orders set cod_collected_at = now(), cod_collected_amount_in_centavos = 105000 where id = 1`;
    expect(await markReturnRefunded(id, proof("ana", "100.00"))).toMatchObject({ ok: true });
  });

  it("measures the Approval limit on the items alone: a Delivery fee never pushes a refund to the CEO", async () => {
    await db.sql`update orders set subtotal_in_centavos = 600000, approved_discount_in_centavos = 0, delivery_fee_in_centavos = 15000, total_in_centavos = 615000 where id = 1`;
    const id = await approved("defective", 500000);
    expect(await markReturnRefunded(id, withFee(proof("ana", "5150.00")))).toMatchObject({ ok: true });
    expect(await feeOf(id)).toMatchObject({ fee: 15000 });
  });
});
