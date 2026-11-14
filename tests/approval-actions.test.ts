import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { approveReturn, markReturnRefunded, getReturnDetail } from "@/features/returns/actions";
import { decideApproval, getApprovalRequests, setApprovalLimit, requestWriteOff, acceptAISuggestion } from "@/features/approvals/actions";
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
  await db.sql`truncate crms.approval_requests, crms.approval_events, order_returns, orders, customers restart identity cascade`;
  await db.sql`update crms.approval_settings set limit_in_centavos = 500000`;
  await db.sql`insert into customers (id, full_name, email) values ('c1','Maria','maria@example.com')`;
  await db.sql`insert into orders (customer_id, status, payment_method) values ('c1','delivered','gcash')`;
  portal = new FakePortal(); storefront = new FakeStorefront(db.sql, undefined, storage); storage.reset(); notices.length = 0; oldDirectory = false; audit.mockClear();
  for (const [id, role] of Object.entries({ ana: "Staff/Employee", mario: "CRMS Manager", ada: "Super Admin", owner: "CEO" })) {
    portal.addStaff(id, { id, username: id, name: `${id} Person`, email: `${id}@example.com`, role }, ["Returns"]);
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
function proof() { const f = new FormData(); f.set("proof", storage.readyEvidence("Returns", PNG, "ana")); return f; }

it.each([500000, 500001])("requires the right steps for a refund selling at %i centavos, excluding delivery", async amount => {
  const id = await returned(amount);
  await signIn("mario"); expect(await approveReturn(id)).toMatchObject({ ok: true });
  await signIn("ana");
  const pending = await markReturnRefunded(id, proof(), { reason: "Damaged cake" });
  expect(pending).toMatchObject({ ok: false, status: "waiting-manager", reason: "Waiting for approval" });
  if (pending.ok || !("approvalId" in pending) || !pending.approvalId) throw new Error("Expected approval id");
  expect([...storage.files.values()].every(file => !file.returnId && file.retentionType === "temporary")).toBe(true);
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "approved" } });
  expect(await getApprovalRequests()).toMatchObject([{ reason: "Damaged cake", status: "waiting-manager" }]);
  expect(notices).toContainEqual(expect.objectContaining({ userIds: ["mario"] }));
  for (const actor of ["ana", "ada", "owner"]) {
    await signIn(actor); expect(await approveReturn(id)).toMatchObject({ ok: false }); expect(await decideApproval("Returns", pending.approvalId, "approve")).toMatchObject({ ok: false });
  }
  await signIn("mario");
  const decision = await decideApproval("Returns", pending.approvalId, "approve");
  expect(decision).toMatchObject({ ok: true, request: { manager_name: "mario Person", manager_at: expect.any(Date), status: amount > 500000 ? "waiting-ceo" : "approved" } });
  if (amount > 500000) {
    await signIn("ana"); expect(await markReturnRefunded(id, proof(), { approvalId: pending.approvalId })).toMatchObject({ ok: false });
    for (const actor of ["mario", "ada"]) { await signIn(actor); expect(await decideApproval("Returns", pending.approvalId, "approve")).toMatchObject({ ok: false }); }
    await signIn("owner"); expect(await decideApproval("Returns", pending.approvalId, "approve")).toMatchObject({ ok: true, request: { ceo_name: "owner Person", ceo_at: expect.any(Date) } });
  } else {
    await signIn("owner"); expect(await decideApproval("Returns", pending.approvalId, "approve")).toMatchObject({ ok: false });
  }
  await signIn("ana"); expect(await markReturnRefunded(id, proof(), { approvalId: pending.approvalId })).toMatchObject({ ok: true });
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "refunded" } });
  expect(audit.mock.calls.map(([e]) => e.action)).toEqual(expect.arrayContaining(["approval.requested", "approval.granted"]));
  expect(notices).toContainEqual(expect.objectContaining({ userIds: ["ana"] }));
});

it("uses an Admin's changed limit and records both write-off decisions and a decline", async () => {
  const id = await returned(500001);
  await signIn("ana"); await expect(setApprovalLimit(600000)).rejects.toThrow();
  for (const actor of ["mario", "owner"]) { await signIn(actor); expect(await setApprovalLimit(600000)).toMatchObject({ ok: false }); }
  await signIn("ada"); expect(await setApprovalLimit(600000)).toMatchObject({ ok: true });
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "approval_limit.changed", actor: { type: "user", id: "ada", display_name: "ada Person" } })]);
  await signIn("ana");
  const requested = await requestWriteOff(id, "Damaged stock");
  expect(requested).toMatchObject({ status: "waiting-manager" });
  if (!requested.approvalId) throw new Error("Missing request");
  await signIn("mario"); expect(await decideApproval("Returns", requested.approvalId, "approve")).toMatchObject({ ok: true, request: { status: "approved" } });
  await signIn("ada"); await setApprovalLimit(400000);
  await signIn("ana"); const other = await requestWriteOff(id, "Second inspection");
  if (!other.approvalId) throw new Error("Missing request");
  await signIn("mario"); expect(await decideApproval("Returns", other.approvalId, "approve")).toMatchObject({ ok: true, request: { status: "waiting-ceo" } });
  await signIn("owner"); expect(await decideApproval("Returns", other.approvalId, "decline", "Restock it")).toMatchObject({ ok: true, request: { status: "declined", ceo_name: "owner Person" } });
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "approval.declined" })]);
});

it("keeps Modules as the page and action gate even for a Manager", async () => {
  await signIn("mario"); portal.revoke("mario", "Returns");
  await expect(getApprovalRequests()).rejects.toThrow();
  await expect(approveReturn(1)).rejects.toThrow();
  expect(storefront.requests).toBe(0);
});

it("records a human's accepted AI suggestion without sending or changing an Order", async () => {
  await signIn("ana");
  expect(await acceptAISuggestion("Returns", "suggestion-1", "1")).toEqual({ ok: true });
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "ai_suggestion.accepted", actor: { type: "user", id: "ana", display_name: "ana Person" } })]);
  expect(storefront.requests).toBe(0);
  await signIn("owner"); expect(await acceptAISuggestion("Returns", "suggestion-2", "1")).toMatchObject({ ok: false });
});

vi.mock("next/server", () => ({ after: (work: () => Promise<void>) => work() }));

it("retains Manager notifications when an old Portal directory omits Roles, then delivers on a user refresh", async () => {
  const id = await returned(500000);
  await signIn("ana"); oldDirectory = true;
  const pending = await approveReturn(id, false, "refund", { reason: "Inspect damage" });
  expect(pending).toMatchObject({ status: "waiting-manager" });
  expect(notices).toHaveLength(0);
  oldDirectory = false;
  await getApprovalRequests();
  expect(notices).toContainEqual(expect.objectContaining({ userIds: ["mario"] }));
});

it("lets an Admin change Portal Settings without granting any Returns page access", async () => {
  await signIn("ada"); portal.revoke("ada", "Returns");
  expect(await setApprovalLimit(700000)).toEqual({ ok: true });
  await expect(getApprovalRequests()).rejects.toThrow();
});

it("records a Manager's first step but prevents their direct above-limit refund", async () => {
  const id = await returned(500001);
  await signIn("mario"); expect(await approveReturn(id)).toMatchObject({ ok: true });
  const pending = await markReturnRefunded(id, undefined, { reason: "Refund damaged cake" });
  expect(pending).toMatchObject({ status: "waiting-ceo", reason: "Waiting for approval" });
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "approved" } });
  expect(await getApprovalRequests()).toMatchObject([{ manager_name: "mario Person", manager_at: expect.any(Date), status: "waiting-ceo" }]);
  if (!("approvalId" in pending) || !pending.approvalId) throw new Error("Missing request");
  await signIn("owner"); expect(await decideApproval("Returns", pending.approvalId, "approve")).toMatchObject({ ok: true });
  expect(await markReturnRefunded(id, undefined, { approvalId: pending.approvalId })).toMatchObject({ ok: false, reason: "Your Role can only view shop work." });
});
