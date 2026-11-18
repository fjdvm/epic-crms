import { withRefundDetails } from "./refund-details";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { inspectReturn, markReturnRefunded, writeOffReturn, getReturnDetail } from "@/features/returns/actions";
import { decideApproval } from "@/features/approvals/actions";
import { FakePortal, FAKE_CALLBACK, FAKE_PORTAL_URL, FAKE_SYSTEM, FAKE_SECRET, portalFetch } from "./fake-portal";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";
import { FakeFileStorage, PNG } from "./fake-file-storage";
import { refundVia, REFUND_PROOF_SQL, REFUND_PROOF_TABLES } from "./refund-via";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const session = vi.hoisted(() => ({ handle: "" }));
const audit = vi.hoisted(() => vi.fn(async (_event: import("@/lib/audit-trail").AuditEvent) => {}));
const storage = new FakeFileStorage();
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit, get gatewayFileStorage() { return storage; } }));
vi.mock("@/features/files/storage", () => ({ storageUrl: (url: string) => url, directFileStorage: { view: (id: string) => storage.view(id) } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: session.handle }) }), headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: (work: () => Promise<void>) => work() }));
vi.mock("@/features/returns/refund-proof-start", () => ({ startRefundProofRead: vi.fn() }));
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
  await db.sql.unsafe(readFileSync("docs/db/crms-approvals.sql", "utf8")); for (const file of REFUND_PROOF_SQL) await db.sql.unsafe(readFileSync(file, "utf8")); await db.sql.unsafe(readFileSync("docs/db/crms-access-audit.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql.unsafe(`truncate ${REFUND_PROOF_TABLES}`);
  await db.sql`truncate crms.approval_requests, crms.approval_events, order_returns, orders, customers restart identity cascade`;
  await db.sql`update crms.approval_settings set limit_in_centavos = 500000`;
  await db.sql`insert into customers (id, full_name, email) values ('c1','Maria','maria@example.com')`;
  await db.sql`insert into orders (customer_id, status, payment_method, subtotal_in_centavos) values ('c1','delivered','gcash', 10000000)`;
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
async function returned(amount: number) {
  const [r] = await db.sql`insert into order_returns (order_id, reason, amount_in_centavos) values (1,'damaged',${amount + 5000}) returning id`;
  const [line] = await db.sql`insert into order_lines (order_id, product_name, price_in_centavos, quantity) values (1,'Cake',${amount},1) returning id`;
  await db.sql`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos)
    values (${r.id},${line.id},'Cake','',1,${amount})`;
  return Number(r.id);
}
function proof(staff = "ana") { const f = new FormData(); f.set("proof", storage.readyEvidence("Returns", PNG, staff)); return withRefundDetails(f, { amount: "0.01" }); }

/** Two whole line items, goods received: a 3,000 tub and a damaged-prone jar of the given price. */
async function received(jarPrice = 2000_00) {
  const [r] = await db.sql`insert into order_returns (order_id, reason, amount_in_centavos, status, goods_required, final_resolution)
    values (1, 'damaged', 1, 'goods received', true, 'refund') returning id`;
  for (const [name, price] of [["Halaya tub", 3000_00], ["Ube jar", jarPrice]] as const) {
    const [line] = await db.sql`insert into order_lines (order_id, product_name, price_in_centavos, quantity) values (1, ${name}, ${price}, 1) returning id`;
    await db.sql`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos)
      values (${r.id}, ${line.id}, ${name}, 'S', 1, ${price})`;
  }
  const lines = await db.sql`select order_line_id from order_return_items where return_id = ${r.id} order by order_line_id`;
  return { id: Number(r.id), lines: lines.map(l => Number(l.order_line_id)) };
}
const mixed = (lines: number[]) => [{ orderLineId: lines[0], condition: "sellable" as const }, { orderLineId: lines[1], condition: "damaged" as const }];

it("Staff inspect item by item: sellable goes back to stock, damaged waits for a write-off", async () => {
  const { id, lines } = await received();
  await signIn("ana");
  expect(await inspectReturn(id, randomUUID(), [{ orderLineId: lines[0], condition: "sellable" }])).toMatchObject({ ok: false, reason: "Mark every item sellable or damaged." });
  expect(storefront.restocked).toEqual([]);
  const inspectionId = randomUUID();
  expect(await inspectReturn(id, inspectionId, mixed(lines))).toMatchObject({ ok: true });
  expect(storefront.restocked).toEqual([{ returnId: id, orderLineId: lines[0], quantity: 1 }]);
  expect(storefront.writtenOff).toEqual([]);
  expect(audit.mock.calls.map(([e]) => e.action)).toContain("return.inspected");
  const detail = await getReturnDetail(id);
  expect(detail).toMatchObject({ ok: true, detail: { items: [expect.objectContaining({ condition: "sellable", inspectedBy: "ana Person" }), expect.objectContaining({ condition: "damaged", writtenOffAt: null })] } });
  expect(await inspectReturn(id, randomUUID(), mixed(lines))).toMatchObject({ ok: false });
  expect(await inspectReturn(id, inspectionId, mixed(lines))).toMatchObject({ ok: true });
  expect(storefront.restocked).toHaveLength(1);
});

it("refuses inspection before goods are received and from read-only Roles", async () => {
  const { id, lines } = await received();
  await db.sql`update order_returns set status = 'approved' where id = ${id}`;
  await signIn("ana"); expect(await inspectReturn(id, randomUUID(), mixed(lines))).toMatchObject({ ok: false });
  await db.sql`update order_returns set status = 'goods received' where id = ${id}`;
  for (const actor of ["ada", "owner"]) { await signIn(actor); expect(await inspectReturn(id, randomUUID(), mixed(lines))).toMatchObject({ ok: false }); }
  expect(storefront.restocked).toEqual([]);
});

it("holds a refund until the items are inspected, then refunds the way the Customer paid with proof", async () => {
  const { id, lines } = await received();
  await signIn("mario");
  expect(await refundVia(db.sql, id, proof("mario"))).toMatchObject({ ok: false, reason: "Inspect the returned items first." });
  await inspectReturn(id, randomUUID(), [{ orderLineId: lines[0], condition: "sellable" }, { orderLineId: lines[1], condition: "sellable" }]);
  expect(await refundVia(db.sql, id, proof("mario"))).toMatchObject({ ok: true });
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "refunded", refundProofFileId: expect.any(String) } });
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "return.refund_approved", operationId: `return:${id}:return.refund_approved` })]);
});

it.each([[1000_00, false], [2000_01, true]])("write-off on a Return whose items sell for %i + 3000 is CEO-final: %s", async (jar, ceo) => {
  // 3,000 sellable + the jar: the limit counts every item on the Return, not only the damaged one.
  const { id, lines } = await received(jar === 1000_00 ? 2000_00 : jar);
  await signIn("ana");
  await inspectReturn(id, randomUUID(), mixed(lines));
  const pending = await writeOffReturn(id, { reason: "Lid cracked" });
  expect(pending).toMatchObject({ ok: false, status: "waiting-manager" });
  if (pending.ok || !("approvalId" in pending) || !pending.approvalId) throw new Error("Expected approval id");
  expect(storefront.writtenOff).toEqual([]);
  await signIn("mario"); expect(await decideApproval("Returns", pending.approvalId, "approve")).toMatchObject({ ok: true, request: { status: ceo ? "waiting-ceo" : "approved" } });
  if (ceo) { await signIn("owner"); expect(await decideApproval("Returns", pending.approvalId, "approve")).toMatchObject({ ok: true }); }
  await signIn("ana");
  expect(await writeOffReturn(id, { approvalId: pending.approvalId })).toMatchObject({ ok: true });
  expect(storefront.writtenOff).toEqual([{ returnId: id, orderLineId: lines[1], quantity: 1 }]);
  expect(audit.mock.calls.map(([e]) => e.action)).toContain("writeoff.approved");
  expect(await writeOffReturn(id, { approvalId: pending.approvalId })).toMatchObject({ ok: false });
});

it("a Manager's write-off at exactly the limit stops at the Manager", async () => {
  const { id, lines } = await received(2000_00); // 3,000 + 2,000 = 5,000
  await signIn("mario");
  await inspectReturn(id, randomUUID(), mixed(lines));
  expect(await writeOffReturn(id, { reason: "Lid cracked" })).toMatchObject({ ok: true });
  expect(storefront.writtenOff).toHaveLength(1);
});

it("needs inspected damaged items to write off, and rolls nothing forward when the storefront refuses", async () => {
  const { id, lines } = await received();
  await signIn("mario");
  expect(await writeOffReturn(id, { reason: "x" })).toMatchObject({ ok: false });
  await inspectReturn(id, randomUUID(), mixed(lines));
  storefront.refusal = "IMS unavailable";
  expect(await writeOffReturn(id, { reason: "Lid cracked" })).toMatchObject({ ok: false });
  expect(storefront.writtenOff).toEqual([]);
});
