import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { approveReturn, markReturnReplaced, extendRefundWindow, getReturnDetail } from "@/features/returns/actions";
import { customersByStageAt } from "@/features/dashboard/customers";
import { ordersIn, salesIn, averageOrderIn, returningBuyersIn } from "@/features/dashboard/figures";
import { decideApproval } from "@/features/approvals/actions";
import { FakePortal, FAKE_CALLBACK, FAKE_PORTAL_URL, FAKE_SYSTEM, FAKE_SECRET, portalFetch } from "./fake-portal";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";
import { FakeFileStorage, PNG } from "./fake-file-storage";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const session = vi.hoisted(() => ({ handle: "" }));
const audit = vi.hoisted(() => vi.fn(async (_event: import("@/lib/audit-trail").AuditEvent) => {}));
const storage = new FakeFileStorage();
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit, get gatewayFileStorage() { return storage; } }));
vi.mock("@/features/files/storage", () => ({ storageUrl: (url: string) => url, directFileStorage: { view: (id: string) => storage.view(id) } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: session.handle }) }), headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: (work: () => Promise<void>) => work() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: () => db.sql }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));
let db: TestDatabase;
let portal: FakePortal;
let storefront: FakeStorefront;
let oldDirectory = false;
const notices: { userIds: string[]; body: string }[] = [];
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-approvals.sql", "utf8")); await db.sql.unsafe(readFileSync("docs/db/crms-access-audit.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate crms.approval_requests, crms.approval_events, order_returns, orders, customers, neon_auth."user" restart identity cascade`;
  await db.sql`update crms.approval_settings set limit_in_centavos = 500000`;
  await db.sql`insert into customers (id, full_name, email) values ('c1','Maria','maria@example.com')`;
  await db.sql`insert into neon_auth."user" (id, "emailVerified") values ('c1', true) on conflict do nothing`;
  await db.sql`insert into orders (customer_id, status, payment_method) values ('c1','delivered','gcash')`;
  portal = new FakePortal(); storefront = new FakeStorefront(db.sql, undefined, storage); storage.reset(); notices.length = 0; oldDirectory = false; audit.mockClear();
  for (const [id, role] of Object.entries({ ana: "Staff/Employee", mario: "CRMS Manager", ada: "Super Admin", owner: "CEO" })) {
    portal.addStaff(id, { id, username: id, name: `${id} Person`, email: `${id}@example.com`, role }, ["Returns", "Fulfilment"]);
  }
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL); vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("CREOMS_DEV_BYPASS", "false"); vi.stubEnv("CREOMS_STOREFRONT_URL", FAKE_STOREFRONT_URL);
  vi.stubEnv("CREOMS_SERVICE_SECRET", FAKE_SERVICE_SECRET); vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "test-key");
  const pf = portalFetch(portal), sf = storefrontFetch(storefront);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin === FAKE_PORTAL_URL) {
      const response = await pf(request);
      if (oldDirectory && url.pathname === "/api/integrations/recipients") {
        const body = await response.json();
        return Response.json({ staff: body.staff.map(({ role: _role, ...person }: { role: string; id: string }) => person) });
      }
      return response;
    }
    if (url.origin === "https://gateway.test") {
      const body = await request.json(); notices.push(body);
      return Response.json({ notifications: [{ id: `n${notices.length}`, readAt: null }] });
    }
    return sf(request);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function signIn(id: string) {
  portal.signIn(id);
  const verifier = "approval-test-proof";
  const url = new URL("/api/integrations/authorize", FAKE_PORTAL_URL);
  url.search = new URLSearchParams({ system: FAKE_SYSTEM, redirect_uri: FAKE_CALLBACK, state: "s", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  const authorized = await portal.handle(new Request(url));
  const exchanged = await portal.handle(new Request(`${FAKE_PORTAL_URL}/api/integrations/exchange`, {
    method: "POST", headers: { authorization: `Basic ${Buffer.from(`${FAKE_SYSTEM}:${FAKE_SECRET}`).toString("base64")}` },
    body: JSON.stringify({ code: new URL(authorized.headers.get("location")!).searchParams.get("code"), state: "s", code_verifier: verifier, redirect_uri: FAKE_CALLBACK }),
  }));
  session.handle = (await exchanged.json()).handle;
}

/** A delivered Order, paid, with one line and a Return that wants a replacement. */
async function wantsReplacement(status = "requested", goodsRequired: boolean | null = null) {
  await db.sql`update orders set subtotal_in_centavos = 150000, delivery_fee_in_centavos = 10000, delivered_at = ${new Date()} where id = 1`;
  const [r] = await db.sql`insert into order_returns (order_id, reason, amount_in_centavos, status, goods_required, preferred_resolution, final_resolution)
    values (1, 'damaged', 150000, ${status}, ${goodsRequired}, 'replacement', ${status === "requested" ? null : "replacement"}) returning id`;
  const [line] = await db.sql`insert into order_lines (order_id, product_name, size_label, price_in_centavos, quantity) values (1, 'Halaya tub', 'L', 150000, 2) returning id`;
  await db.sql`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos) values (${r.id}, ${line.id}, 'Halaya tub', 'L', 2, 150000)`;
  return Number(r.id);
}
const replacementOrders = () => db.sql`select * from orders where replacement_for_order_id is not null`;

it("a Manager approving the replacement creates the linked ₱0 Order, reserves its stock, quotes no fee and emails once", async () => {
  const id = await wantsReplacement("approved", false);
  await signIn("mario");
  expect(await markReturnReplaced(id)).toMatchObject({ ok: true });
  const [created] = await replacementOrders();
  expect(created).toMatchObject({ replacement_for_order_id: 1, replacement_for_return_id: id, subtotal_in_centavos: 0, delivery_fee_in_centavos: 0, customer_id: "c1" });
  expect(storefront.reservations).toEqual([{ orderId: created.id, productName: "Halaya tub", sizeLabel: "L", quantity: 2 }]);
  expect(storefront.replacementEmails).toEqual([{ returnId: id, replacementOrderId: created.id }]);
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "replaced", replacementOrderId: created.id } });
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "return.replacement_order_created", operationId: `return:${id}:replacement_order_created`, actor: expect.objectContaining({ id: "mario" }) })]);
});

it("repeating the approval never makes a second Order or a second email", async () => {
  const id = await wantsReplacement("approved", false);
  await signIn("mario");
  await markReturnReplaced(id);
  await db.sql`update order_returns set status = 'approved' where id = ${id}`;
  expect(await markReturnReplaced(id)).toMatchObject({ ok: true });
  expect(await replacementOrders()).toHaveLength(1);
  expect(storefront.replacementEmails).toHaveLength(1);
});

it("refuses the replacement, and does not mark it Replaced, when the stock is gone", async () => {
  const id = await wantsReplacement("approved", false);
  storefront.outOfStock.add("Halaya tub|L");
  await signIn("mario");
  expect(await markReturnReplaced(id)).toMatchObject({ ok: false, reason: "Halaya tub (L) is out of stock for a replacement." });
  expect(await replacementOrders()).toHaveLength(0);
  expect(await getReturnDetail(id)).toMatchObject({ detail: { status: "approved" } });
  expect(audit.mock.calls.map(([e]) => e.action)).not.toContain("return.replacement_order_created");
});

it("Staff ask a Manager for the replacement and nothing is created until it is approved", async () => {
  const id = await wantsReplacement("approved", false);
  await signIn("ana");
  const asked = await markReturnReplaced(id, { reason: "Same item, damaged in transit" });
  expect(asked).toMatchObject({ ok: false, reason: "Waiting for approval" });
  expect(await replacementOrders()).toHaveLength(0);
  await signIn("mario");
  expect(await decideApproval("Returns", (asked as { approvalId: string }).approvalId, "approve")).toMatchObject({ ok: true });
  await signIn("ana");
  expect(await markReturnReplaced(id, { approvalId: (asked as { approvalId: string }).approvalId })).toMatchObject({ ok: true });
  expect(await replacementOrders()).toHaveLength(1);
});

it("Total spent, order count, Stage, Buyers and Sales ignore the Replacement Order", async () => {
  const id = await wantsReplacement("approved", false);
  await db.sql`update orders set status = 'delivered' where id = 1`;
  const sql = db.sql;
  const span = { start: new Date(Date.now() - 86_400_000), end: new Date(Date.now() + 86_400_000) };
  const before = { sales: await salesIn(sql, span), orders: await ordersIn(sql, span), average: await averageOrderIn(sql, span), buyers: await returningBuyersIn(sql, span) };
  await signIn("mario");
  await markReturnReplaced(id);
  expect(await replacementOrders()).toHaveLength(1);
  expect({ sales: await salesIn(sql, span), orders: await ordersIn(sql, span), average: await averageOrderIn(sql, span), buyers: await returningBuyersIn(sql, span) }).toEqual(before);
  const stages = await customersByStageAt(sql, new Date());
  expect(stages.counts["first-order"]).toBe(1);
  expect(stages.counts.repeat).toBe(0);
});

it("a Manager extends the window once by 24 hours with a reason; a second try is refused", async () => {
  await wantsReplacement();
  await signIn("mario");
  expect(await extendRefundWindow(1, "  ")).toMatchObject({ ok: false, reason: "Enter a reason for extending the window." });
  const first = await extendRefundWindow(1, "Customer was travelling");
  expect(first).toMatchObject({ ok: true });
  expect((first as { endsAt: Date }).endsAt.getTime()).toBeGreaterThan(Date.now() + 24 * 3600_000);
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "return.window_extended", target: expect.objectContaining({ id: "1" }) })]);
  expect(await extendRefundWindow(1, "Again")).toMatchObject({ ok: false, reason: "The Refund window was already extended once." });
  const [order] = await db.sql`select refund_window_extension_reason from orders where id = 1`;
  expect(order.refund_window_extension_reason).toBe("Customer was travelling");
  expect(await getReturnDetail(1)).toMatchObject({ ok: true, detail: { refundWindowExtendedAt: expect.any(Date) } });
});

it("Staff see Request approval for the window; Admin and CEO cannot extend", async () => {
  await wantsReplacement();
  await signIn("ana");
  const asked = await extendRefundWindow(1, "Customer was travelling");
  expect(asked).toMatchObject({ ok: false, reason: "Waiting for approval" });
  expect((await db.sql`select refund_window_extended_at from orders where id = 1`)[0].refund_window_extended_at).toBeNull();
  const approvalId = (asked as { approvalId: string }).approvalId;
  await signIn("mario");
  await decideApproval("Returns", approvalId, "approve");
  await signIn("ana");
  expect(await extendRefundWindow(1, "Customer was travelling", { approvalId })).toMatchObject({ ok: true });
  for (const actor of ["ada", "owner"]) { await signIn(actor); expect(await extendRefundWindow(1, "x")).toMatchObject({ ok: false }); }
});

it("will not extend the window of an Order that is not delivered", async () => {
  await wantsReplacement();
  await db.sql`update orders set status = 'dispatched' where id = 1`;
  await signIn("mario");
  expect(await extendRefundWindow(1, "Why")).toMatchObject({ ok: false, reason: "Only a delivered Order has a Refund window to extend." });
});
