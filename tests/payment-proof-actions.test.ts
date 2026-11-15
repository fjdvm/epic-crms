import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { markPaid, rejectPaymentProof, loadPaymentQueue, loadPayments } from "@/features/orders/actions";
import { loadOrder } from "@/features/orders/orders";
import { decideApproval, getApprovalRequests } from "@/features/approvals/actions";
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
vi.mock("next/server", () => ({ after: (work: () => Promise<void>) => work() }));
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
  await db.sql`truncate crms.approval_requests, crms.approval_events, order_payment_proofs, order_returns, orders, customers restart identity cascade`;
  await db.sql`update crms.approval_settings set limit_in_centavos = 500000`;
  await db.sql`insert into customers (id, full_name, email) values ('c1','Maria','maria@example.com')`;
    portal = new FakePortal(); storefront = new FakeStorefront(db.sql, undefined, storage); storage.reset(); notices.length = 0; oldDirectory = false; audit.mockClear();
  for (const [id, role] of Object.entries({ ana: "Staff/Employee", mario: "CRMS Manager", ada: "Super Admin", owner: "CEO" })) {
    portal.addStaff(id, { id, username: id, name: `${id} Person`, email: `${id}@example.com`, role }, ["Payments"]);
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

async function proofOrder(method = "gcash") {
  const [o] = await db.sql`insert into orders (customer_id, status, payment_method) values ('c1','awaiting payment',${method}) returning id`;
  await storefront.submitProof(o.id, "REF-1");
  return Number(o.id);
}
/** Staff reject the current proof and the Customer sends another. */
async function rejectAndResubmit(id: number, n: number) {
  for (let i = 1; i <= n; i++) {
    expect(await rejectPaymentProof(id, `Blurry ${i}`)).toMatchObject({ ok: true });
    await storefront.submitProof(id, `REF-${i + 1}`);
  }
}

it.each(["gcash", "maya", "bank-transfer"])("queues a %s proof and marks it paid with a payment.marked_paid audit", async method => {
  const id = await proofOrder(method);
  await signIn("ana");
  expect(await loadPaymentQueue()).toMatchObject({ ok: true, orders: [{ id }] });
  expect(await markPaid(id)).toMatchObject({ ok: true, order: { status: "paid" } });
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "payment.marked_paid", module: "Payments" })]);
});

it("rejects a proof with a reason, emails one re-upload link, keeps it, and resubmission returns it to checking", async () => {
  const id = await proofOrder();
  await signIn("ana");
  expect(await rejectPaymentProof(id, "   ")).toEqual({ ok: false, reason: "Enter a reason for rejecting the proof." });
  expect(storefront.reuploadEmails).toEqual([]);
  expect(await rejectPaymentProof(id, "Amount does not match")).toMatchObject({ ok: true, order: { status: "awaiting payment" } });
  expect(storefront.reuploadEmails).toHaveLength(1);
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "payment_proof.rejected", metadata: { reason: "Amount does not match", rejections: 1 } })]);
  // Rejected proofs leave the checking queue and cannot be marked paid or rejected twice.
  expect(await loadPaymentQueue()).toEqual({ ok: true, orders: [] });
  expect(await markPaid(id)).toMatchObject({ ok: false, reason: expect.stringContaining("rejected") });
  expect(await rejectPaymentProof(id, "Again")).toMatchObject({ ok: false, reason: expect.stringMatching(/already changed/) });
  expect(await loadPayments()).toMatchObject({ rows: [expect.objectContaining({ id, rejections: 1, proofRejectedAt: expect.any(Date) })] });
  await storefront.submitProof(id, "REF-2");
  expect(await loadPaymentQueue()).toMatchObject({ orders: [{ id, paymentProof: { reference: "REF-2" } }] });
  expect(await markPaid(id)).toMatchObject({ ok: true });
});

it("keeps every proof and rejection, oldest first", async () => {
  const id = await proofOrder();
  await signIn("ana");
  await rejectAndResubmit(id, 2);
  const result = await loadOrder(() => db.sql, id);
  if (!result.ok || !result.order) throw new Error("Order missing");
  expect(result.order.paymentProofs.map(p => [p.reference, p.rejection?.reason ?? null, p.rejection?.by.name ?? null])).toEqual([
    ["REF-1", "Blurry 1", "ana Person"], ["REF-2", "Blurry 2", "ana Person"], ["REF-3", null, null],
  ]);
  expect(result.order.proofRejections).toBe(2);
});

it("refuses rejection and payment for Cash on Delivery and non-Staff roles, and shows no refusal as success", async () => {
  const cod = Number((await db.sql`insert into orders (customer_id, status, payment_method) values ('c1','awaiting payment','cash-on-delivery') returning id`)[0].id);
  const id = await proofOrder();
  await signIn("ana");
  expect(await rejectPaymentProof(cod, "No")).toMatchObject({ ok: false });
  for (const actor of ["ada", "owner"]) {
    await signIn(actor);
    expect(await rejectPaymentProof(id, "No")).toMatchObject({ ok: false });
    expect(await markPaid(id)).toMatchObject({ ok: false });
  }
  storefront.refusal = "The Customer has already cancelled this Order.";
  await signIn("ana");
  expect(await rejectPaymentProof(id, "No")).toEqual({ ok: false, reason: storefront.refusal });
  expect(storefront.reuploadEmails).toEqual([]);
});

describe("after 3 rejections", () => {
  it("makes Staff request approval with a reason and lets a Manager approve anyway", async () => {
    const id = await proofOrder();
    await signIn("ana");
    await rejectAndResubmit(id, 3);
    expect(await markPaid(id)).toEqual({ ok: false, reason: "Enter a reason to approve this payment anyway." });
    const pending = await markPaid(id, { reason: "Customer showed the bank slip at the counter" });
    expect(pending).toMatchObject({ ok: false, status: "waiting-manager", reason: "Waiting for approval" });
    if (pending.ok || !("approvalId" in pending) || !pending.approvalId) throw new Error("Expected approval id");
    expect(notices).toContainEqual(expect.objectContaining({ userIds: ["mario"] }));
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ order: { status: "awaiting payment" } });
    // Staff cannot use the request until a Manager approves it.
    expect(await markPaid(id, { approvalId: pending.approvalId })).toMatchObject({ ok: false });
    await signIn("mario");
    expect(await decideApproval("Payments", pending.approvalId, "approve")).toMatchObject({ ok: true, request: { status: "approved", manager_name: "mario Person" } });
    await signIn("ana");
    expect(await markPaid(id, { approvalId: pending.approvalId })).toMatchObject({ ok: true, order: { status: "paid" } });
    expect(audit.mock.calls).toContainEqual([expect.objectContaining({
      action: "payment.approved_anyway", metadata: { reason: "Customer showed the bank slip at the counter" },
    })]);
  });

  it("lets a Manager approve anyway directly, only with a reason, even while the last proof is rejected", async () => {
    const id = await proofOrder();
    await signIn("ana");
    await rejectAndResubmit(id, 2);
    expect(await rejectPaymentProof(id, "Blurry 3")).toMatchObject({ ok: true });
    await signIn("mario");
    expect(await markPaid(id)).toEqual({ ok: false, reason: "Enter a reason to approve this payment anyway." });
    expect(await markPaid(id, { reason: "  " })).toMatchObject({ ok: false });
    expect(await markPaid(id, { reason: "Confirmed in the bank app" })).toMatchObject({ ok: true, order: { status: "paid" } });
    expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "payment.approved_anyway", actor: expect.objectContaining({ id: "mario" }) })]);
    expect(audit.mock.calls.map(([e]) => e.action)).not.toContain("payment.marked_paid");
  });

  it("does not let an approval for one Order pay another", async () => {
    const [a, b] = [await proofOrder(), await proofOrder()];
    await signIn("ana");
    await rejectAndResubmit(a, 3); await rejectAndResubmit(b, 3);
    const pending = await markPaid(a, { reason: "Slip seen" });
    if (pending.ok || !("approvalId" in pending) || !pending.approvalId) throw new Error("Expected approval id");
    await signIn("mario"); await decideApproval("Payments", pending.approvalId, "approve");
    await signIn("ana");
    expect(await markPaid(b, { approvalId: pending.approvalId })).toMatchObject({ ok: false });
  });
});
