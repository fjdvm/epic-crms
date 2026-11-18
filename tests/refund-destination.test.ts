import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { changeRefundDestination, getReturnDetail, markReturnRefunded, revealRefundDestination } from "@/features/returns/actions";
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


const GCASH = { method: "gcash", accountName: "Maria Santos", accountNumber: "09171234567" };
const NEW = { method: "maya", accountName: "Maria S. Santos", accountNumber: "09189876543", reason: "Her GCash was closed", customerConfirmed: true };

/** A delivered Order and an approved refund Return with the Customer's confirmed destination. */
async function approvedRefund(status = "approved", goodsRequired = false) {
  await db.sql`update orders set delivered_at = ${new Date()} where id = 1`;
  const [r] = await db.sql`insert into order_returns (order_id, reason, amount_in_centavos, status, goods_required, preferred_resolution, final_resolution,
    refund_method, refund_account_name, refund_account_number) values (1, 'damaged', 150000, ${status}, ${goodsRequired}, 'refund', 'refund', 'gcash', 'Maria Santos', '09171234567') returning id`;
  const [line] = await db.sql`insert into order_lines (order_id, product_name, size_label, price_in_centavos, quantity) values (1, 'Halaya tub', 'L', 150000, 1) returning id`;
  await db.sql`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos) values (${r.id}, ${line.id}, 'Halaya tub', 'L', 1, 150000)`;
  return Number(r.id);
}
const stored = async (id: number) => (await db.sql`select refund_method, refund_account_number from order_returns where id = ${id}`)[0];
const everything = () => JSON.stringify([audit.mock.calls, notices]);
const proof = () => { const f = new FormData(); f.append("proof", new File([PNG], "p.png", { type: "image/png" })); return f; };

it("shows Staff and Managers only the masked number, never the full one, in the Return detail", async () => {
  const id = await approvedRefund();
  await signIn("ana");
  const read = await getReturnDetail(id);
  expect(read).toMatchObject({ ok: true, detail: { refundDestination: { method: "gcash", accountName: "Maria Santos", maskedNumber: "•••••••4567" }, refundDestinationLocked: true } });
  expect(JSON.stringify(read)).not.toContain("09171234567");
});

it("a Return that is only Requested is not locked yet", async () => {
  const id = await approvedRefund("requested");
  await signIn("ana");
  expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { refundDestinationLocked: false } });
});

it("opens the full number only when the refund is ready to send, and audits the look masked", async () => {
  const id = await approvedRefund("approved", true);
  await signIn("ana");
  expect(await revealRefundDestination(id)).toMatchObject({ ok: false, reason: "The full number is shown only when the refund is ready to be sent." });
  await db.sql`update order_returns set status = 'goods received' where id = ${id}`;
  expect(await revealRefundDestination(id)).toMatchObject({ ok: true, destination: { accountNumber: "09171234567" } });
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "return.refund_destination_viewed", description: expect.stringContaining("•••••••4567") })]);
  expect(everything()).not.toContain("09171234567");
  await db.sql`update order_returns set status = 'refunded' where id = ${id}`;
  expect(await revealRefundDestination(id)).toMatchObject({ ok: false });
});

it("Admin and CEO see it masked and cannot open the full number", async () => {
  const id = await approvedRefund();
  for (const actor of ["ada", "owner"]) {
    await signIn(actor);
    expect(await revealRefundDestination(id)).toMatchObject({ ok: false });
    expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { refundDestination: { maskedNumber: "•••••••4567" } } });
  }
});

it("Staff cannot type a different destination at refund time", async () => {
  const id = await approvedRefund();
  await signIn("ana");
  const form = proof();
  form.append("accountNumber", "09990000000");
  expect(await markReturnRefunded(id, form)).toMatchObject({ ok: false, reason: expect.stringContaining("cannot be changed here") });
  expect((await stored(id)).refund_account_number).toBe("09171234567");
  expect(storefront.requests).toBe(0);
});

it("a Manager changes the destination with a reason and the Customer's confirmation; the audit holds it masked", async () => {
  const id = await approvedRefund();
  await signIn("mario");
  const done = await changeRefundDestination(id, NEW);
  expect(done).toMatchObject({ ok: true, destination: { method: "maya", maskedNumber: "•••••••6543" } });
  expect(await stored(id)).toMatchObject({ refund_method: "maya", refund_account_number: "09189876543" });
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "return.refund_destination_changed",
    description: expect.stringContaining("from GCash •••••••4567 to Maya •••••••6543"), metadata: expect.objectContaining({ reason: "Her GCash was closed", customerConfirmed: true }) })]);
  expect(everything()).not.toMatch(/09171234567|09189876543/);
});

it("refuses a change without a reason, the Customer's confirmation, valid details, or any real difference", async () => {
  const id = await approvedRefund();
  await signIn("mario");
  expect(await changeRefundDestination(id, { ...NEW, reason: "  " })).toMatchObject({ ok: false, reason: "Enter a reason for changing the destination." });
  expect(await changeRefundDestination(id, { ...NEW, customerConfirmed: false })).toMatchObject({ ok: false, reason: expect.stringContaining("Customer must confirm") });
  expect(await changeRefundDestination(id, { ...NEW, accountNumber: "123" })).toMatchObject({ ok: false, reason: expect.stringContaining("11-digit") });
  expect(await changeRefundDestination(id, { ...NEW, method: "bank-transfer", accountNumber: "1234567890", bankName: "" })).toMatchObject({ ok: false, reason: "Enter the bank name." });
  expect(await changeRefundDestination(id, { ...GCASH, reason: "same", customerConfirmed: true })).toMatchObject({ ok: false, reason: "That is already the confirmed destination." });
  expect(storefront.requests).toBe(0);
  expect((await stored(id)).refund_account_number).toBe("09171234567");
});

it("cannot change it once money was sent, or on a Return that is not an approved refund", async () => {
  const sent = await approvedRefund("refunded");
  await signIn("mario");
  expect(await changeRefundDestination(sent, NEW)).toMatchObject({ ok: false, reason: expect.stringContaining("approved refund that has not been sent") });
  const open = await approvedRefund("requested");
  expect(await changeRefundDestination(open, NEW)).toMatchObject({ ok: false });
});

it("when the storefront refuses, nothing changes and the reason is passed on", async () => {
  const id = await approvedRefund();
  await signIn("mario");
  storefront.refusal = "Money was already sent.";
  expect(await changeRefundDestination(id, NEW)).toMatchObject({ ok: false, reason: "Money was already sent." });
  expect((await stored(id)).refund_account_number).toBe("09171234567");
  expect(audit.mock.calls.filter(([e]) => e.action === "return.refund_destination_changed")).toHaveLength(0);
});

it("Staff see Request approval; the request holds no full number; the approved change then goes through", async () => {
  const id = await approvedRefund();
  await signIn("ana");
  const asked = await changeRefundDestination(id, NEW);
  expect(asked).toMatchObject({ ok: false, reason: "Waiting for approval" });
  expect((await stored(id)).refund_account_number).toBe("09171234567");
  const approvalId = (asked as { approvalId: string }).approvalId;
  const [request] = await db.sql`select payload::text as payload, reason from crms.approval_requests where id = ${approvalId}`;
  expect(request.payload).not.toMatch(/09189876543/);
  expect(request.payload).toContain("•••••••6543");
  await signIn("mario");
  expect(await decideApproval("Returns", approvalId, "approve")).toMatchObject({ ok: true });
  await signIn("ana");
  expect(await changeRefundDestination(id, { ...NEW, accountNumber: "09180000000" }, { approvalId })).toMatchObject({ ok: false, reason: "The approved action changed. Request approval again." });
  expect(await changeRefundDestination(id, NEW, { approvalId })).toMatchObject({ ok: true });
  expect(await stored(id)).toMatchObject({ refund_account_number: "09189876543" });
  expect(everything()).not.toMatch(/09171234567|09189876543/);
});

it("Admin and CEO cannot change it", async () => {
  const id = await approvedRefund();
  for (const actor of ["ada", "owner"]) { await signIn(actor); expect(await changeRefundDestination(id, NEW)).toMatchObject({ ok: false }); }
  expect((await stored(id)).refund_account_number).toBe("09171234567");
});
