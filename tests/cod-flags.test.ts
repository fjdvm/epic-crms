import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { loadCodFlags, loadCodFlagsForOrders, setCodAmount } from "@/features/orders/cod-actions";
import { FakePortal, FAKE_CALLBACK, FAKE_PORTAL_URL, FAKE_SYSTEM, FAKE_SECRET, portalFetch } from "./fake-portal";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const session = vi.hoisted(() => ({ handle: "" }));
const audit = vi.hoisted(() => vi.fn(async (_event: import("@/lib/audit-trail").AuditEvent) => {}));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: session.handle }) }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: () => db.sql }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));
let db: TestDatabase;
let portal: FakePortal;

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql`alter table customers add column contact_number text`;
  await db.sql.unsafe(readFileSync("docs/db/crms-cod-settings.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-access-audit.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate failed_deliveries, orders, customers restart identity cascade`;
  await db.sql`update crms.cod_settings set first_order_amount_in_centavos = 150000`;
  audit.mockClear();
  portal = new FakePortal();
  for (const [id, role] of Object.entries({ ana: "Staff/Employee", ada: "Super Admin", mario: "CRMS Manager" })) {
    portal.addStaff(id, { id, username: id, name: `${id} Person`, email: `${id}@example.com`, role }, ["Orders"]);
  }
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL); vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET); vi.stubEnv("CREOMS_DEV_BYPASS", "false");
  const pf = portalFetch(portal);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => pf(new Request(input, init)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function signIn(id: string) {
  portal.signIn(id);
  const url = new URL("/api/integrations/authorize", FAKE_PORTAL_URL);
  url.search = new URLSearchParams({ system: FAKE_SYSTEM, redirect_uri: FAKE_CALLBACK, state: "s", code_challenge: createHash("sha256").update("v").digest("base64url"), code_challenge_method: "S256" }).toString();
  const authorized = await portal.handle(new Request(url));
  const exchanged = await portal.handle(new Request(`${FAKE_PORTAL_URL}/api/integrations/exchange`, {
    method: "POST", headers: { authorization: `Basic ${Buffer.from(`${FAKE_SYSTEM}:${FAKE_SECRET}`).toString("base64")}` },
    body: JSON.stringify({ code: new URL(authorized.headers.get("location")!).searchParams.get("code"), state: "s", code_verifier: "v", redirect_uri: FAKE_CALLBACK }),
  }));
  session.handle = (await exchanged.json()).handle;
}
async function customer(id: string, phone: string | null) {
  await db.sql`insert into customers (id, full_name, email, contact_number) values (${id}, ${id}, ${id + "@example.com"}, ${phone})`;
}
async function order(customerId: string, subtotal: number, method = "cash-on-delivery") {
  const [o] = await db.sql`insert into orders (customer_id, subtotal_in_centavos, payment_method) values (${customerId}, ${subtotal}, ${method}) returning id`;
  return o.id as number;
}
async function failed(orderId: number, reason: string) {
  await db.sql`insert into failed_deliveries (id, order_id, reason, next_step, customer_message, staff_id, staff_name) values (${crypto.randomUUID()}, ${orderId}, ${reason}, 'rebook', 'hi', 's', 'S')`;
}
async function rules(id: number) {
  const result = await loadCodFlags(id);
  if (!result.ok) throw new Error(result.reason);
  return (result.flags[id] ?? []).map(f => f.rule);
}

it("flags a first small order only as a first order", async () => {
  await signIn("ana"); await customer("c1", "0917 111 1111");
  expect(await rules(await order("c1", 100000))).toEqual(["first-order"]);
});
it("flags a first order over the amount with both rules, and exactly the amount is not over", async () => {
  await signIn("ana"); await customer("c1", null); await customer("c2", null);
  expect(await rules(await order("c1", 150001))).toEqual(["first-order", "first-order-over-amount"]);
  expect(await rules(await order("c2", 150000))).toEqual(["first-order"]);
});
it("flags nothing for a returning Customer and nothing for a prepaid Order", async () => {
  await signIn("ana"); await customer("c1", null);
  await order("c1", 100);
  const second = await order("c1", 900000);
  expect(await rules(second)).toEqual([]);
  await customer("c2", null);
  const prepaid = await order("c2", 900000, "gcash");
  expect((await loadCodFlags(prepaid))).toEqual({ ok: true, flags: {} });
});
it("flags a phone that refused an earlier Order even from another account, and any earlier failed delivery", async () => {
  await signIn("ana"); await customer("old", "09171234567"); await customer("new", "+63 917 123 4567"); await customer("same", null); await customer("other", "09990000000");
  await order("other", 1);
  const earlier = await order("old", 100); await failed(earlier, "Refused to pay COD");
  const mine = await order("same", 100); await failed(mine, "Customer not home");
  await db.sql`update orders set customer_id = 'same' where false`;
  const viaPhone = await order("new", 100);
  expect(await rules(viaPhone)).toEqual(["first-order", "refused-earlier-order", "earlier-failed-delivery"]);
  const again = await order("same", 100);
  expect(await rules(again)).toEqual(["earlier-failed-delivery"]);
});
it("does not count a failed delivery on a later Order of the same Customer", async () => {
  await signIn("ana"); await customer("c1", null);
  const first = await order("c1", 100); const later = await order("c1", 100); await failed(later, "Refused the item");
  expect(await rules(first)).toEqual(["first-order"]);
});
it("logs each rule once per Order with a stable key, never scores, and lists flags for many Orders without logging", async () => {
  await signIn("ana"); await customer("c1", null);
  const id = await order("c1", 200000);
  const result = await loadCodFlags(id);
  expect(JSON.stringify(result)).not.toMatch(/score|percent|risk/i);
  expect(audit.mock.calls.map(([e]) => [e.action, e.operationId])).toEqual([["cod_flag.raised", `cod:${id}:first-order`], ["cod_flag.raised", `cod:${id}:first-order-over-amount`]]);
  audit.mockClear();
  expect(await loadCodFlagsForOrders([id])).toMatchObject({ ok: true });
  expect(audit).not.toHaveBeenCalled();
});
it("lets only an Admin change the amount, applies it to later flags and logs the change", async () => {
  await customer("c1", null);
  const id = await order("c1", 200000);
  await signIn("ana"); await expect(setCodAmount(300000)).rejects.toThrow();
  await signIn("ada"); expect(await setCodAmount(-1)).toMatchObject({ ok: false });
  expect(await setCodAmount(300000)).toEqual({ ok: true });
  expect(audit.mock.calls.map(([e]) => e).filter(e => e.action.startsWith("cod")).map(e => [e.action, e.actor.id, e.metadata])).toEqual([["cod_amount.changed", "ada", { previous: 150000, amountInCentavos: 300000 }]]);
  await signIn("ana"); expect(await rules(id)).toEqual(["first-order"]);
});
