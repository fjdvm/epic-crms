import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { decideReturn, getReturnDetail, markReturnRefunded, requestReturnDecision } from "@/features/returns/actions";
import { decideApproval, getApprovalRequests } from "@/features/approvals/actions";
import { loadReplacementStock } from "@/features/returns/replacement-stock";
import { FakePortal, FAKE_CALLBACK, FAKE_PORTAL_URL, FAKE_SYSTEM, FAKE_SECRET, portalFetch } from "./fake-portal";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";
import { FakeFileStorage, PNG } from "./fake-file-storage";
import { REFUND_PROOF_SQL, REFUND_PROOF_TABLES } from "./refund-via";
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
const stock = vi.hoisted(() => ({ available: new Map<number, number | null>(), down: false }));
vi.mock("@/lib/storefront", async (original) => ({
  ...(await original<typeof import("@/lib/storefront")>()),
  readStock: async (ids: number[]) => stock.down ? null
    : new Map(ids.map((id) => [id, { sizeId: id, quantity: null, reserved: null, available: stock.available.has(id) ? stock.available.get(id)! : 99 }])),
}));
let db: TestDatabase;
let portal: FakePortal;
let storefront: FakeStorefront;
let oldDirectory = false;
const notices: { userIds: string[]; body: string }[] = [];
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-approvals.sql", "utf8")); await db.sql.unsafe(readFileSync("docs/db/crms-access-audit.sql", "utf8"));
  for (const file of REFUND_PROOF_SQL) await db.sql.unsafe(readFileSync(file, "utf8"));
  await db.sql`create table if not exists stock_reservations (id text primary key, order_id integer, state text not null, lines jsonb not null)`;
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate crms.approval_requests, crms.approval_events, order_returns, orders, customers, neon_auth."user", stock_reservations restart identity cascade`;
  await db.sql.unsafe(`truncate ${REFUND_PROOF_TABLES}`);
  stock.available.clear(); stock.down = false;
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

/** A delivered Order with one line (Size 7 on its Reservation) and a Requested Return for it. */
async function requested({ hoursSinceDelivery = 1, amount = 150000, preferred = "refund" } = {}) {
  await db.sql`update orders set subtotal_in_centavos = ${amount}, delivered_at = ${new Date(Date.now() - hoursSinceDelivery * 3_600_000)} where id = 1`;
  const [r] = await db.sql`insert into order_returns (order_id, reason, amount_in_centavos, preferred_resolution) values (1, 'damaged', ${amount}, ${preferred}) returning id`;
  const [line] = await db.sql`insert into order_lines (order_id, product_name, size_label, price_in_centavos, quantity) values (1, 'Halaya tub', 'L', ${amount / 2}, 2) returning id`;
  await db.sql`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos) values (${r.id}, ${line.id}, 'Halaya tub', 'L', 2, ${amount / 2})`;
  await db.sql`insert into stock_reservations values (${`order-${r.id}`}, 1, 'packed', ${db.sql.json([{ orderLineId: line.id, sizeId: 7, quantity: 2 }] as never)}) on conflict do nothing`;
  return Number(r.id);
}
const decideRequests = async () => (await db.sql`select * from crms.approval_requests where action = 'return.decide' order by requested_at`);

it("Staff check a Return and ask a Manager to decide it; the window comes from the server, never the browser", async () => {
  const inside = await requested();
  await signIn("ana");
  expect(await decideReturn(inside, { outcome: "refund", goodsRequired: false })).toMatchObject({ ok: false, reason: expect.stringContaining("Request approval · decide return") });
  expect(await requestReturnDecision(inside, { photoSupportsReason: true, note: "  " })).toEqual({ ok: false, reason: "Enter a note for the Manager." });
  expect(await requestReturnDecision(inside, { photoSupportsReason: "yes" as never, note: "x" })).toMatchObject({ ok: false });
  expect(await requestReturnDecision(inside, { photoSupportsReason: true, note: "Seal broken in photo 1", inWindow: false } as never)).toMatchObject({ ok: true });
  expect(await requestReturnDecision(inside, { photoSupportsReason: true, note: "again" })).toEqual({ ok: false, reason: "A Manager was already asked to decide this Return." });
  const [request] = await decideRequests();
  expect(request).toMatchObject({ status: "waiting-manager", requester_id: "ana", reason: "Seal broken in photo 1", payload: { inWindow: true, photoSupportsReason: true } });
  expect(notices).toContainEqual(expect.objectContaining({ userIds: ["mario"] }));
  expect(await getReturnDetail(inside)).toMatchObject({ ok: true, detail: { status: "requested" } });

  const late = await requested({ hoursSinceDelivery: 30 });
  expect(await requestReturnDecision(late, { photoSupportsReason: false, note: "Asked a day late" })).toMatchObject({ ok: true });
  expect((await decideRequests()).at(-1)).toMatchObject({ payload: { inWindow: false, photoSupportsReason: false } });

  for (const actor of ["mario", "ada", "owner"]) {
    await signIn(actor);
    expect(await requestReturnDecision(late, { photoSupportsReason: true, note: "x" })).toMatchObject({ ok: false });
  }
  for (const actor of ["ada", "owner"]) expect(await (await signIn(actor), decideReturn(late, { outcome: "reject", reason: "No" }))).toMatchObject({ ok: false });
});

it("the Manager picks the outcome on the Return; the request closes under their name and Staff are told", async () => {
  const id = await requested();
  await signIn("ana"); await requestReturnDecision(id, { photoSupportsReason: false, note: "Photo is blurry" });
  const [request] = await decideRequests();
  await signIn("mario");
  expect(await decideApproval("Returns", request.id, "approve")).toEqual({ ok: false, reason: "Open the Return and pick its outcome there." });
  expect(await decideReturn(id, { outcome: "reject", reason: " " })).toMatchObject({ ok: false });
  expect(await decideReturn(id, { outcome: "reject", reason: "The photo shows normal wear." })).toMatchObject({ ok: true });
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "declined", declineReason: "The photo shows normal wear." } });
  expect((await decideRequests())[0]).toMatchObject({ status: "completed", manager_id: "mario", manager_name: "mario Person" });
  expect(notices).toContainEqual(expect.objectContaining({ userIds: ["ana"] }));
  expect(audit.mock.calls.map(([e]) => e.action)).toEqual(expect.arrayContaining(["approval.requested", "approval.granted", "return.declined"]));
  await signIn("ana");
  expect((await getApprovalRequests()).find((r) => r.action === "return.decide")).toMatchObject({ status: "completed" });
});

it("a replacement without the goods back is made at once as a linked ₱0 Order", async () => {
  const id = await requested({ preferred: "replacement" });
  await signIn("mario");
  expect(await decideReturn(id, { outcome: "replacement" } as never)).toEqual({ ok: false, reason: "Say whether the goods must come back." });
  expect(await decideReturn(id, { outcome: "replacement", goodsRequired: false })).toMatchObject({ ok: true });
  const [order] = await db.sql`select * from orders where replacement_for_return_id = ${id}`;
  expect(order).toMatchObject({ subtotal_in_centavos: 0, replacement_for_order_id: 1 });
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "replaced", finalResolution: "replacement", replacementOrderId: order.id } });
});

it("a replacement with the goods back is only approved; the Order is made after inspection", async () => {
  const id = await requested({ preferred: "replacement" });
  await signIn("mario");
  expect(await decideReturn(id, { outcome: "replacement", goodsRequired: true })).toMatchObject({ ok: true });
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "approved", goodsRequired: true, finalResolution: "replacement" } });
  expect(await db.sql`select 1 from orders where replacement_for_return_id = ${id}`).toHaveLength(0);
});

it("refuses a replacement when the IMS is short of an item, and leaves stock it cannot read to the store", async () => {
  const id = await requested({ preferred: "replacement" });
  stock.available.set(7, 1);
  expect(await loadReplacementStock(() => db.sql, id)).toEqual({ state: "short", items: [{ product: "Halaya tub", size: "L" }] });
  await signIn("mario");
  expect(await decideReturn(id, { outcome: "replacement", goodsRequired: false })).toEqual({ ok: false, reason: "Not enough stock for a replacement: Halaya tub (L)." });
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "requested" } });
  stock.available.set(7, 2);
  expect(await loadReplacementStock(() => db.sql, id)).toEqual({ state: "available" });
  stock.down = true;
  expect(await loadReplacementStock(() => db.sql, id)).toEqual({ state: "unknown" });
  expect(await decideReturn(id, { outcome: "replacement", goodsRequired: false })).toMatchObject({ ok: true });
});

it("over the Approval limit the Manager decides the refund, then asks the CEO before any proof or money", async () => {
  const id = await requested({ amount: 600000 });
  await signIn("mario");
  expect(await decideReturn(id, { outcome: "refund", goodsRequired: false })).toMatchObject({ ok: true });
  const asked = await markReturnRefunded(id, undefined, { reason: "Whole batch spoiled" });
  expect(asked).toMatchObject({ ok: false, reason: "Waiting for approval", status: "waiting-ceo" });
  expect(storage.files.size).toBe(0);
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "approved", finalResolution: "refund" } });
  await signIn("owner");
  expect(await decideApproval("Returns", (asked as { approvalId: string }).approvalId, "approve")).toMatchObject({ ok: true, request: { status: "approved", ceo_name: "owner Person" } });
});
