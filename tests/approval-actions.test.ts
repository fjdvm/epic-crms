import { withRefundDetails } from "./refund-details";
import { randomUUID } from "node:crypto";
import { changeFailedDelivery, loadFailedDeliveryHistory } from "@/features/orders/failed-delivery-actions";
import { requestDispatchedCancellation, settleDispatchedCancellation, loadDispatchedCancellations } from "@/features/orders/cancellation-actions";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { approveReturn, markReturnRefunded, getReturnDetail } from "@/features/returns/actions";
import { decideApproval, getApprovalRequests, setApprovalLimit, requestWriteOff, acceptAISuggestion } from "@/features/approvals/actions";
import { FakePortal, FAKE_CALLBACK, FAKE_PORTAL_URL, FAKE_SYSTEM, FAKE_SECRET, portalFetch } from "./fake-portal";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";
import { FakeFileStorage, PNG } from "./fake-file-storage";
import { refundVia, REFUND_PROOF_SQL, REFUND_PROOF_TABLES } from "./refund-via";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const session = vi.hoisted(() => ({ handle: "" }));
const audit = vi.hoisted(() => vi.fn(async (_event: import("@/lib/audit-trail").AuditEvent) => {}));
const storage = new FakeFileStorage();
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit, deliverGatewayAuditEvent: audit, get gatewayFileStorage() { return storage; } }));
vi.mock("@/features/files/storage", () => ({ storageUrl: (url: string) => url, directFileStorage: { view: (id: string) => storage.view(id) } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: session.handle }) }), headers: async () => new Headers() }));
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
  await db.sql.unsafe(readFileSync("docs/db/crms-approvals.sql", "utf8")); for (const file of REFUND_PROOF_SQL) await db.sql.unsafe(readFileSync(file, "utf8")); await db.sql.unsafe(readFileSync("docs/db/crms-access-audit.sql", "utf8")); await db.sql.unsafe(readFileSync("docs/db/crms-pending-audit.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql.unsafe(`truncate ${REFUND_PROOF_TABLES}`); await db.sql`truncate crms.pending_audit_records, crms.approval_requests, crms.approval_events, order_returns, orders, customers restart identity cascade`;
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
function proof(pesos = "100.00") { const f = new FormData(); f.set("proof", storage.readyEvidence("Returns", PNG, "ana")); return withRefundDetails(f, { amount: pesos }); }

it.each([500000, 500001])("requires the right steps for a refund selling at %i centavos, excluding delivery", async amount => {
  const id = await returned(amount);
  await signIn("mario"); expect(await approveReturn(id)).toMatchObject({ ok: true });
  await signIn("ana");
  const pending = await refundVia(db.sql, id, proof((amount / 100).toFixed(2)), { reason: "Damaged cake" });
  expect(pending).toMatchObject({ ok: false, status: "waiting-manager", reason: "Waiting for approval" });
  if (pending.ok || !("approvalId" in pending) || !pending.approvalId) throw new Error("Expected approval id");
  expect([...storage.files.values()].every(file => file.retentionType === "temporary")).toBe(true);
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "approved" } });
  expect(await getApprovalRequests()).toMatchObject([{ reason: "Damaged cake", status: "waiting-manager" }]);
  expect(notices).toContainEqual(expect.objectContaining({ userIds: ["mario"] }));
  for (const actor of ["ana", "ada"]) {
    await signIn(actor); expect(await approveReturn(id)).toMatchObject({ ok: false }); expect(await decideApproval("Returns", pending.approvalId, "approve")).toMatchObject({ ok: false });
  }
  // One Manager-level approval is final at any amount; the CEO decides as a Manager does.
  await signIn(amount > 500000 ? "owner" : "mario");
  const approver = amount > 500000 ? "owner Person" : "mario Person";
  const decision = await decideApproval("Returns", pending.approvalId, "approve");
  expect(decision).toMatchObject({ ok: true, request: { manager_name: approver, manager_at: expect.any(Date), status: "approved" } });
  for (const actor of ["mario", "owner"]) { await signIn(actor); expect(await decideApproval("Returns", pending.approvalId, "approve")).toMatchObject({ ok: false }); }
  await signIn("ana"); expect(await refundVia(db.sql, id, proof((amount / 100).toFixed(2)), { approvalId: pending.approvalId })).toMatchObject({ ok: true });
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "refunded" } });
  expect(audit.mock.calls.map(([e]) => e.action)).toEqual(expect.arrayContaining(["approval.requested", "approval.granted"]));
  expect(notices).toContainEqual(expect.objectContaining({ userIds: ["ana"] }));
});

it("lets a Manager save the limit, and records a Manager's write-off approval and the CEO's decline", async () => {
  const id = await returned(500001);
  await signIn("ana"); await expect(setApprovalLimit(600000)).rejects.toThrow();
  await signIn("ada"); expect(await setApprovalLimit(600000)).toMatchObject({ ok: false });
  await signIn("owner"); expect(await setApprovalLimit(500000)).toMatchObject({ ok: true });
  await signIn("mario"); expect(await setApprovalLimit(600000)).toMatchObject({ ok: true });
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "approval_limit.changed", actor: { type: "user", id: "mario", display_name: "mario Person" } })]);
  await signIn("ana");
  const requested = await requestWriteOff(id, "Damaged stock");
  expect(requested).toMatchObject({ status: "waiting-manager" });
  if (!requested.approvalId) throw new Error("Missing request");
  await signIn("mario"); expect(await decideApproval("Returns", requested.approvalId, "approve")).toMatchObject({ ok: true, request: { status: "approved" } });
  await signIn("mario"); await setApprovalLimit(400000);
  await signIn("ana"); const other = await requestWriteOff(id, "Second inspection");
  if (!other.approvalId) throw new Error("Missing request");
  await signIn("owner"); expect(await decideApproval("Returns", other.approvalId, "decline", "Restock it")).toMatchObject({ ok: true, request: { status: "declined", manager_name: "owner Person" } });
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
  await signIn("ada"); expect(await acceptAISuggestion("Returns", "suggestion-2", "1")).toMatchObject({ ok: false });
});

it("audits denied approval attempts once each, and decisions through pending records (#748)", async () => {
  const id = await returned(600000);
  await signIn("ana"); const pending = await requestWriteOff(id, "Damaged stock");
  if (!pending.approvalId) throw new Error("Missing request");
  const failures = () => audit.mock.calls.map(([e]) => e).filter(e => e.outcome === "failure" && e.target.type === "approval");
  for (const _ of [1, 2]) { await signIn("ana"); expect(await decideApproval("Returns", pending.approvalId, "approve")).toMatchObject({ ok: false }); }
  await signIn("ada"); expect(await setApprovalLimit(1)).toMatchObject({ ok: false });
  await signIn("mario"); expect(await decideApproval("Returns", pending.approvalId, "decline", "")).toMatchObject({ ok: false });
  expect(failures().map(e => e.action).sort()).toEqual(["approval.granted", "approval.granted", "approval.declined", "approval_limit.changed"].sort());
  expect(failures()[0]).toMatchObject({ actor: { id: "ana" }, target: { id: pending.approvalId }, metadata: { reason: "Your Role cannot decide this approval step." } });
  expect(new Set(failures().map(e => e.operationId)).size).toBe(3);
  expect(JSON.stringify(failures())).not.toMatch(/@example\.com/);
  expect(await decideApproval("Returns", pending.approvalId, "approve")).toMatchObject({ ok: true });
  expect(await db.sql`select state from crms.pending_audit_records where event->>'action' = 'approval.granted'`).toEqual([{ state: "delivered" }]);
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

it("lets a Manager change the Approval limit without granting any Returns page access", async () => {
  await signIn("mario"); portal.revoke("mario", "Returns");
  expect(await setApprovalLimit(700000)).toEqual({ ok: true });
  await expect(getApprovalRequests()).rejects.toThrow();
});

it("lets a Manager refund above the limit directly, with no CEO step", async () => {
  const id = await returned(500001);
  await signIn("mario"); expect(await approveReturn(id)).toMatchObject({ ok: true });
  const direct = await markReturnRefunded(id, undefined, { reason: "Refund damaged cake" });
  expect(direct).not.toMatchObject({ reason: "Waiting for approval" });
  expect(await getApprovalRequests()).toEqual([]);
  const own = new FormData(); own.set("proof", storage.readyEvidence("Returns", PNG, "mario"));
  expect(await refundVia(db.sql, id, withRefundDetails(own, { amount: "5000.01" }))).toMatchObject({ ok: true });
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "refunded" } });
});

it.each([500000, 500001])("failed-delivery write-off at %i is final once a Manager approves", async amount => {
  await db.sql`update orders set status = 'dispatched', fulfillment_method = 'delivery' where id = 1`;
  await db.sql`insert into order_lines (order_id, product_name, price_in_centavos, quantity) values (1,'Cake',${amount},1)`;
  const attemptId = randomUUID();
  await signIn("ana");
  expect(await changeFailedDelivery(1, { action: "record", attemptId, reason: "Damaged in transit", nextStep: "request-cancellation", customerMessage: "We requested cancellation from the Manager." })).toMatchObject({ ok: true, attemptId });
  expect(await loadFailedDeliveryHistory(1)).toMatchObject({ ok: true, history: [expect.objectContaining({ reason: "Damaged in transit" })] });
  const pending = await changeFailedDelivery(1, { action: "write-off", attemptId }, { reason: "Goods damaged" });
  expect(pending).toMatchObject({ ok: false, status: "waiting-manager" });
  if (!("approvalId" in pending) || !pending.approvalId) throw new Error("Expected approval");
  expect((await db.sql`select disposition from failed_deliveries`)[0].disposition).toBeNull();
  await signIn("mario");
  expect(await decideApproval("Fulfilment", pending.approvalId, "approve")).toMatchObject({ ok: true, request: { status: "approved" } });
  await signIn("ada");
  expect(await decideApproval("Fulfilment", pending.approvalId, "approve")).toMatchObject({ ok: false });
  expect(await changeFailedDelivery(1, { action: "restock", attemptId })).toMatchObject({ ok: false });
  await signIn("ana");
  expect(await changeFailedDelivery(1, { action: "write-off", attemptId }, { approvalId: pending.approvalId })).toMatchObject({ ok: true });
  expect((await db.sql`select status from orders where id = 1`)[0].status).toBe("dispatched");
  expect((await db.sql`select disposition from failed_deliveries`)[0].disposition).toBe("write-off");
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "writeoff.requested" }));
});

it("failed delivery actions preserve refusals, rebook courier details and enforce read-only Roles", async () => {
  await db.sql`update orders set status = 'dispatched', fulfillment_method = 'delivery' where id = 1`;
  const attemptId = randomUUID();
  await signIn("ana");
  expect(await changeFailedDelivery(1, { action: "record", attemptId, reason: "Not home", nextStep: "rebook", customerMessage: "Staff will rebook." })).toMatchObject({ ok: true });
  storefront.refusal = "Courier booking changed. Refresh first.";
  expect(await changeFailedDelivery(1, { action: "rebook", attemptId, courier: { name: "Grab", trackingUrl: "https://grab.test/new" } })).toMatchObject({ ok: false, reason: storefront.refusal });
  storefront.refusal = null;
  expect(await changeFailedDelivery(1, { action: "rebook", attemptId, courier: { name: "Grab", trackingUrl: "https://grab.test/new" } })).toMatchObject({ ok: true });
  expect(storefront.couriers.get(1)).toEqual({ name: "Grab", trackingUrl: "https://grab.test/new" });
  for (const actor of ["ada"]) {
    await signIn(actor);
    expect(await changeFailedDelivery(1, { action: "restock", attemptId })).toMatchObject({ ok: false, reason: "Your Role can only view shop work." });
    expect(await loadFailedDeliveryHistory(1)).toMatchObject({ ok: true });
  }
});

it("a changed Admin limit applies to failed-delivery requests, and module revocation stops direct actions", async () => {
  await db.sql`update orders set status = 'dispatched', fulfillment_method = 'delivery' where id = 1`;
  await db.sql`insert into order_lines (order_id, product_name, price_in_centavos, quantity) values (1,'Cake',500001,1)`;
  const attemptId = randomUUID();
  await signIn("ana");
  expect(await changeFailedDelivery(1, { action: "record", attemptId, reason: "Damaged", nextStep: "request-cancellation", customerMessage: "Staff requested cancellation." })).toMatchObject({ ok: true });
  const { approvals } = await import("@/features/approvals/server");
  // The same Admin setting entry point used by Portal Settings.
  expect(await approvals().setLimit({ id: "mario", username: "mario", name: "Mario", email: "mario@example.com", role: "CRMS Manager" }, 600000)).toMatchObject({ ok: true });
  await signIn("mario");
  expect(await changeFailedDelivery(1, { action: "write-off", attemptId })).toMatchObject({ ok: true });
  portal.addStaff("no-fulfilment", { id: "no-fulfilment", username: "no-fulfilment", name: "Other Person", email: "other@example.com", role: "Staff" }, ["Orders"]);
  await signIn("no-fulfilment");
  const requests = storefront.requests;
  await expect(changeFailedDelivery(1, { action: "restock", attemptId })).rejects.toThrow();
  expect(storefront.requests).toBe(requests);
});

it("a Staff cancellation request waits for a Manager without cancelling or handling stock", async () => {
  await db.sql`update orders set status = 'dispatched', payment_method = 'cash-on-delivery' where id = 1`;
  await signIn("ana");
  const pending = await requestDispatchedCancellation(1, "Customer asked to stop delivery");
  expect(pending).toMatchObject({ ok: false, reason: "Waiting for approval", status: "waiting-manager" });
  expect(await loadDispatchedCancellations()).toMatchObject({ ok: true, requests: [expect.objectContaining({ orderId: 1, status: "waiting-manager", reason: "Customer asked to stop delivery" })] });
  expect(notices).toContainEqual(expect.objectContaining({ userIds: ["mario"], link: expect.stringContaining("fulfilment") }));
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "approval.requested" }));
});

async function cancellation(amount = 10000, method = "cash-on-delivery") {
  await db.sql`update orders set status = 'dispatched', payment_method = ${method} where id = 1`;
  await db.sql`insert into order_lines (order_id, product_name, price_in_centavos, quantity) values (1,'Cake',${amount},1)`;
  await signIn("ana");
  const pending = await requestDispatchedCancellation(1, "Customer requested cancellation");
  if (!("approvalId" in pending) || !pending.approvalId) throw new Error("Expected Manager approval");
  return pending.approvalId;
}
function cancellationProof(staffId = "mario") { const form = new FormData(); form.set("proof", storage.readyEvidence("Fulfilment", PNG, staffId)); return form; }

it("requires a Manager decision before COD cancellation and records stock without a refund", async () => {
  const id = await cancellation();
  await signIn("mario");
  expect(await settleDispatchedCancellation(1, id, "restock")).toMatchObject({ ok: false, reason: "A Manager must approve this cancellation first." });
  expect(await decideApproval("Fulfilment", id, "decline", "line one\nline two")).toMatchObject({ ok: false });
  expect(await decideApproval("Fulfilment", id, "decline", "x".repeat(1001))).toMatchObject({ ok: false });
  expect(await decideApproval("Fulfilment", id, "approve")).toMatchObject({ ok: true });
  expect(await requestDispatchedCancellation(1, "Same request")).toMatchObject({ status: "approved", reason: "Cancellation approved; settlement pending" });
  expect(await settleDispatchedCancellation(1, id, "restock", cancellationProof())).toMatchObject({ ok: false, reason: "Cash on Delivery has no refund." });
  for (const actor of ["ana", "ada"]) {
    await signIn(actor); expect(await settleDispatchedCancellation(1, id, "restock")).toMatchObject({ ok: false });
  }
  await signIn("mario");
  expect(await settleDispatchedCancellation(1, id, "restock")).toMatchObject({ ok: true, status: "cancelled" });
  expect(await loadDispatchedCancellations()).toMatchObject({ ok: true, requests: [expect.objectContaining({ status: "cancelled", stockOutcome: "restock", refundMethod: null, refundProofFileId: null })] });
  expect(await settleDispatchedCancellation(1, id, "restock")).toMatchObject({ ok: false });
});

it.each(["gcash", "maya", "bank-transfer"])("refunds a prepaid %s cancellation using its own method and confirmed proof", async method => {
  const id = await cancellation(500000, method);
  await signIn("mario"); await decideApproval("Fulfilment", id, "approve");
  expect(await settleDispatchedCancellation(1, id, "restock")).toMatchObject({ ok: false, reason: "Choose exactly one refund proof screenshot." });
  expect(await settleDispatchedCancellation(1, id, "restock", cancellationProof("ana"))).toMatchObject({ ok: false });
  expect(await settleDispatchedCancellation(1, id, "restock", cancellationProof())).toMatchObject({ ok: true, status: "cancelled" });
  expect(await loadDispatchedCancellations()).toMatchObject({ ok: true, requests: [expect.objectContaining({ refundMethod: method, refundProofFileId: expect.any(String), stockOutcome: "restock" })] });
  expect([...storage.files.values()].some(file => file.orderId === 1 && file.retentionType === "permanent")).toBe(true);
});

it.each([["gcash", "restock"], ["cash-on-delivery", "write-off"]] as const)("settles %s/%s above the saved limit once a Manager approves, with no CEO step", async (method, outcome) => {
  const id = await cancellation(500001, method);
  await signIn("mario"); await decideApproval("Fulfilment", id, "approve");
  expect(await settleDispatchedCancellation(1, id, outcome, method === "gcash" ? cancellationProof() : undefined)).toMatchObject({ ok: true, status: "cancelled" });
  expect((await db.sql`select status from crms.approval_requests where status = 'waiting-ceo'`)).toHaveLength(0);
});

it("preserves storefront refusals and does not consume the cancellation approval", async () => {
  const id = await cancellation();
  await signIn("mario"); await decideApproval("Fulfilment", id, "approve");
  storefront.refusal = "Reconcile stock before cancellation.";
  expect(await settleDispatchedCancellation(1, id, "restock")).toMatchObject({ ok: false, reason: storefront.refusal });
  expect(await loadDispatchedCancellations()).toMatchObject({ ok: true, requests: [expect.objectContaining({ status: "approved" })] });
  storefront.refusal = null;
  expect(await settleDispatchedCancellation(1, id, "restock")).toMatchObject({ ok: true });
});

it("discovers a Customer's own cancellation request as a Manager approval, without granting Customer approval authority", async () => {
  await db.sql`update orders set status = 'dispatched' where id = 1`;
  const send = (customer: string) => storefront.handle(new Request(`${FAKE_STOREFRONT_URL}/api/orders/1/cancellation`, { method: "POST", headers: { "X-Test-Customer": customer }, body: JSON.stringify({ reason: "Wrong delivery address" }) }));
  expect((await send("other-customer")).status).toBe(409);
  const response = await send("c1"); expect(response.status).toBe(202);
  const request = await response.json();
  await signIn("mario");
  expect(await loadDispatchedCancellations()).toMatchObject({ ok: true, requests: [expect.objectContaining({ requestId: request.requestId, status: "waiting-manager" })] });
  expect(await getApprovalRequests("Fulfilment")).toMatchObject([expect.objectContaining({ requester_id: "customer:c1", status: "waiting-manager" })]);
  expect(notices).toContainEqual(expect.objectContaining({ userIds: ["mario"] }));
  await decideApproval("Fulfilment", request.requestId, "decline", "Courier can still deliver");
  expect(await (await send("c1")).json()).toMatchObject({ status: "declined" });
  expect(await settleDispatchedCancellation(1, request.requestId, "restock")).toMatchObject({ ok: false });
});

it("resumes an interrupted prepaid settlement from stored proof after the browser reference is gone", async () => {
  const id = await cancellation(500000, "maya");
  await signIn("mario"); await decideApproval("Fulfilment", id, "approve");
  storefront.interruptCancellation = true;
  expect(await settleDispatchedCancellation(1, id, "restock", cancellationProof())).toMatchObject({ ok: false, reason: expect.stringContaining("IMS did not confirm") });
  expect(await loadDispatchedCancellations()).toMatchObject({ ok: true, requests: [expect.objectContaining({ refundProofFileId: expect.any(String), stockOutcome: "restock" })] });
  expect([...storage.files.values()].some(file => file.orderId === 1 && file.retentionType === "permanent")).toBe(true);
  storefront.interruptCancellation = false;
  expect(await settleDispatchedCancellation(1, id, "restock")).toMatchObject({ ok: true, status: "cancelled" });
  expect(await loadDispatchedCancellations()).toMatchObject({ ok: true, requests: [expect.objectContaining({ status: "cancelled", refundMethod: "maya" })] });
});

it("keeps an above-limit settlement retryable when proof preparation fails before any cancellation", async () => {
  const id = await cancellation(500001, "gcash");
  await signIn("mario"); await decideApproval("Fulfilment", id, "approve");
  storage.failPromote = true;
  expect(await settleDispatchedCancellation(1, id, "restock", cancellationProof())).toMatchObject({ ok: false, reason: expect.stringContaining("No cancellation was sent") });
  storage.failPromote = false;
  expect(await settleDispatchedCancellation(1, id, "restock", cancellationProof())).toMatchObject({ ok: true, status: "cancelled" });
});

const eventsOf = (outcome: "success" | "failure") => audit.mock.calls.map(([event]) => event).filter(event => event.outcome === outcome && /^(failed_delivery|order\.cancel)/.test(event.action));

it("audits each failed-delivery change once, with ids only, and its refusals as denied attempts (#746)", async () => {
  await db.sql`update orders set status = 'dispatched', fulfillment_method = 'delivery' where id = 1`;
  await db.sql`insert into order_lines (order_id, product_name, price_in_centavos, quantity) values (1,'Cake',1000,1)`;
  const attemptId = randomUUID();
  await signIn("ana");
  expect(await changeFailedDelivery(1, { action: "record", attemptId, reason: "Gate locked, Maria 0917", nextStep: "rebook", customerMessage: "Staff will rebook." })).toMatchObject({ ok: true });
  storefront.refusal = "Courier booking changed. Refresh first.";
  expect((await changeFailedDelivery(1, { action: "rebook", attemptId, courier: { name: "Grab" } })).ok).toBe(false);
  expect((await changeFailedDelivery(1, { action: "rebook", attemptId, courier: { name: "Grab" } })).ok).toBe(false);
  storefront.refusal = null;
  expect((await changeFailedDelivery(1, { action: "rebook", attemptId, courier: { name: "Grab" } })).ok).toBe(true);
  const done = eventsOf("success");
  expect(done.map(event => event.action)).toEqual(["failed_delivery.recorded", "failed_delivery.rebooked"]);
  expect(done[0]).toMatchObject({ module: "Fulfilment", target: { type: "order", id: "1" }, actor: expect.objectContaining({ id: "ana" }), metadata: { attempt_id: attemptId, next_step: "rebook" } });
  const denied = eventsOf("failure");
  expect(denied).toHaveLength(2);
  expect(denied[0]).toMatchObject({ action: "failed_delivery.rebooked", metadata: { attempt_id: attemptId, reason: "Courier booking changed. Refresh first." } });
  expect(denied[1].operationId).toBe(denied[0].operationId);
  expect(JSON.stringify(audit.mock.calls.filter(([event]) => event.action.startsWith("failed_delivery")))).not.toMatch(/0917|Gate locked/);
  // A read-only Role is a denied attempt too.
  await signIn("ada");
  expect(await changeFailedDelivery(1, { action: "restock", attemptId })).toMatchObject({ ok: false, reason: "Your Role can only view shop work." });
  expect(eventsOf("failure")[2]).toMatchObject({ action: "failed_delivery.restocked", actor: expect.objectContaining({ id: "ada" }) });
});

it("records a failed-delivery write-off through a pending audit record, once, after Manager approval (#746)", async () => {
  await db.sql`update orders set status = 'dispatched', fulfillment_method = 'delivery' where id = 1`;
  await db.sql`insert into order_lines (order_id, product_name, price_in_centavos, quantity) values (1,'Cake',1000,1)`;
  const attemptId = randomUUID();
  await signIn("ana");
  await changeFailedDelivery(1, { action: "record", attemptId, reason: "Damaged", nextStep: "request-cancellation", customerMessage: "Requested." });
  await signIn("mario");
  expect(await changeFailedDelivery(1, { action: "write-off", attemptId })).toMatchObject({ ok: true });
  expect(eventsOf("success").map(event => event.action)).toEqual(["failed_delivery.recorded", "failed_delivery.written_off"]);
  expect(await db.sql`select state from crms.pending_audit_records where event->>'action' = 'failed_delivery.written_off'`).toEqual([{ state: "delivered" }]);
  // A replay of the same write-off keeps one record and delivers one event.
  expect((await changeFailedDelivery(1, { action: "write-off", attemptId })).ok).toBe(true);
  expect(await db.sql`select 1 from crms.pending_audit_records where event->>'action' = 'failed_delivery.written_off'`).toHaveLength(1);
  expect(eventsOf("success").filter(event => event.action === "failed_delivery.written_off")).toHaveLength(1);
});

it("audits a dispatched cancellation request and settlement through pending records, and refusals as denied attempts (#746)", async () => {
  const id = await cancellation();
  expect(eventsOf("success")).toEqual([expect.objectContaining({ action: "order.cancellation_requested", metadata: expect.objectContaining({ request_id: id }) })]);
  expect(await db.sql`select state from crms.pending_audit_records where event->>'action' = 'order.cancellation_requested'`).toEqual([{ state: "delivered" }]);
  await signIn("mario");
  expect(await settleDispatchedCancellation(1, id, "restock")).toMatchObject({ ok: false, reason: "A Manager must approve this cancellation first." });
  expect(eventsOf("failure")).toEqual([expect.objectContaining({ action: "order.cancelled_after_dispatch", metadata: { request_id: id, reason: "A Manager must approve this cancellation first." } })]);
  await decideApproval("Fulfilment", id, "approve");
  expect(await settleDispatchedCancellation(1, id, "restock")).toMatchObject({ ok: true, status: "cancelled" });
  const settled = eventsOf("success").filter(event => event.action === "order.cancelled_after_dispatch");
  expect(settled).toEqual([expect.objectContaining({ module: "Fulfilment", target: { type: "order", id: "1", display_name: "Order #1" }, actor: expect.objectContaining({ id: "mario" }),
    metadata: { request_id: id, stock_outcome: "restock", refund_method: null } })]);
  expect(await settleDispatchedCancellation(1, id, "restock")).toMatchObject({ ok: false });
  expect(await db.sql`select 1 from crms.pending_audit_records where event->>'action' = 'order.cancelled_after_dispatch'`).toHaveLength(1);
  // A Staff member's refused settlement is a denied attempt too.
  await signIn("ana");
  await settleDispatchedCancellation(1, id, "restock");
  expect(eventsOf("failure").at(-1)).toMatchObject({ actor: expect.objectContaining({ id: "ana" }), metadata: { request_id: id, reason: "Only a CREOMS Manager can settle a dispatched cancellation." } });
});
