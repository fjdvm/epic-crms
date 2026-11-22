import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { quoteDeliveryFee as realQuote } from "@/features/orders/actions";
import { approveVerification, declineVerification, loadVerificationDetail, loadVerificationPhoto, loadVerifications, overrideVerification, revokeVerification } from "@/features/senior-pwd/actions";
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

/** The total Staff would have seen on screen: what the database holds for the Order. */
async function shownTotal(id: number, fee: number) {
  const [row] = Number.isSafeInteger(id) ? await db.sql`select subtotal_in_centavos as s, coalesce((to_jsonb(o) ->> 'discount_in_centavos')::int, 0) as d from orders o where id = ${id}` : [];
  return row ? row.s - row.d + fee : 0;
}
const quoteDeliveryFee = async (id: number, fee: number, choice?: Parameters<typeof realQuote>[3]) => realQuote(id, fee, await shownTotal(id, fee), choice);
let portal: FakePortal;
let storefront: FakeStorefront;
let oldDirectory = false;
const notices: { userIds: string[]; body: string }[] = [];
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-approvals.sql", "utf8")); await db.sql.unsafe(readFileSync("docs/db/crms-access-audit.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-senior-pwd-id-reads.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate crms.approval_requests, crms.approval_events, order_payment_proofs, senior_pwd_verifications, order_returns, orders, customers restart identity cascade`;
  await db.sql`update crms.approval_settings set limit_in_centavos = 500000`;
  await db.sql`insert into customers (id, full_name, email) values ('c1','Maria','maria@example.com')`;
    portal = new FakePortal(); storefront = new FakeStorefront(db.sql, undefined, storage); storage.reset(); notices.length = 0; oldDirectory = false; audit.mockClear();
  for (const [id, role] of Object.entries({ ana: "Staff/Employee", mario: "CRMS Manager", ada: "Super Admin", owner: "CEO" })) {
    portal.addStaff(id, { id, username: id, name: `${id} Person`, email: `${id}@example.com`, role }, ["Orders", "Senior/PWD"]);
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


const NUMBER = "SC-123-456-789";
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const logged: string[] = [];
beforeEach(() => {
  logged.length = 0;
  for (const level of ["log", "warn", "error", "info"] as const) vi.spyOn(console, level).mockImplementation((...a) => { logged.push(JSON.stringify(a)); });
});

/** The Customer uploads the ID photo (private, temporary) and types the number. */
async function upload(customerId = "c1", number = NUMBER) {
  const photo = await storage.upload({ filename: "id.png", contentType: "image/png", bytes: PNG, retentionType: "temporary" });
  const id = await storefront.submitVerification(customerId, "senior", number, photo);
  if (typeof id !== "number") throw new Error(id.error);
  return { id, photo };
}
const everything = () => JSON.stringify({ audit: audit.mock.calls, emails: storefront.verificationEmails, logged });

it("approves with the ID's expiry date, deletes the photo, audits once and emails once, never with the number", async () => {
  const { id, photo } = await upload();
  await signIn("mario");
  expect(await loadVerifications()).toMatchObject({ ok: true, list: { pending: [{ id, customerName: "Maria", idType: "senior" }] } });
  const result = await approveVerification(id, future(400));
  expect(result).toEqual({ ok: true, status: "approved", photoRemoved: true });
  expect(storage.files.has(photo)).toBe(false);
  const list = await loadVerifications();
  expect(list).toMatchObject({ ok: true, list: { pending: [], decided: [{ id, status: "approved", decidedByName: "mario Person", expiresOn: future(400), photoFileId: null }] } });
  // Only the verified mark, approver, expiry and a hash are kept; CREOMS can read no hash.
  expect(JSON.stringify(list)).not.toMatch(/hash/i);
  expect(audit.mock.calls.filter(([e]) => e.action === "pwd.approved")).toHaveLength(1);
  expect(audit.mock.calls[0][0]).toMatchObject({ actor: { display_name: "mario Person" }, target: { type: "customer", id: "c1" } });
  expect(storefront.verificationEmails).toHaveLength(1);
  expect(everything()).not.toContain(NUMBER);
  expect(everything()).not.toContain("123-456");
});

it("declines only with a reason, tells the Customer, and deletes the photo", async () => {
  const { id, photo } = await upload();
  await signIn("mario");
  expect(await declineVerification(id, "  ")).toEqual({ ok: false, reason: "Enter a reason for declining." });
  expect(storage.files.has(photo)).toBe(true);
  expect(await declineVerification(id, "Name does not match")).toMatchObject({ ok: true, status: "declined", photoRemoved: true });
  expect(storage.files.has(photo)).toBe(false);
  expect(storefront.verificationEmails).toEqual([{ verificationId: id, status: "declined", text: expect.stringContaining("Name does not match") }]);
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "pwd.declined", metadata: expect.objectContaining({ reason: "Name does not match" }) })]);
  expect(await approveVerification(id, future(30))).toMatchObject({ ok: false, reason: expect.stringMatching(/already changed/) });
  expect(everything()).not.toContain(NUMBER);
});

it("refuses a missing, malformed or already-past expiry date", async () => {
  const { id } = await upload();
  await signIn("mario");
  for (const bad of ["", "soon", "2026-02-30", future(-1)]) {
    expect(await approveVerification(id, bad)).toMatchObject({ ok: false });
  }
  expect(storefront.verificationEmails).toEqual([]);
});

it("refuses the same ID number on a second account, whatever its spacing or case", async () => {
  await db.sql`insert into customers (id, full_name, email) values ('c2','Pedro','pedro@example.com')`;
  await upload("c1", NUMBER);
  const photo = await storage.upload({ filename: "id.png", contentType: "image/png", bytes: PNG, retentionType: "temporary" });
  expect(await storefront.submitVerification("c2", "senior", " sc-123-456-789 ", photo)).toEqual({ error: "This ID is already used by another account." });
});

it("flags an ID number the storefront saw on another account, naming who without exposing the number or hash", async () => {
  await db.sql`insert into customers (id, full_name, email) values ('c2','Pedro Cruz','pedro.cruz@example.com')`;
  const first = await upload("c1", NUMBER);
  await signIn("mario");
  await declineVerification(first.id, "Blurry photo");
  // The first holder was declined, so the same number is accepted on a second account, but flagged.
  const second = await upload("c2", NUMBER);
  const list = await loadVerifications();
  expect(list).toMatchObject({ ok: true, list: { pending: [{ id: second.id, sameIdAs: { verificationId: first.id, customerName: "Maria", customerEmailHint: "maria@...", status: "declined" } }] } });
  expect(JSON.stringify(list)).not.toMatch(/hash|SC-123/i);
  // The first account's own row is not flagged.
  expect(await loadVerificationDetail(first.id)).toMatchObject({ ok: true, verification: { id: first.id, sameIdAs: null } });
});

it("removes a photo nobody reviewed in 7 days; Staff can no longer decide and the Customer must upload again", async () => {
  const { id } = await upload();
  await db.sql`update senior_pwd_verifications set submitted_at = now() - interval '8 days'`;
  await signIn("mario");
  // Even before the storefront sweeps, a lapsed one is no longer work for Staff.
  expect(await loadVerifications()).toMatchObject({ list: { pending: [], decided: [{ id, status: "expired" }] } });
  expect(await approveVerification(id, future(30))).toMatchObject({ ok: false });
  expect(await loadVerificationPhoto(id)).toMatchObject({ ok: false });
  await storefront.removeStalePhotos();
  expect(await loadVerifications()).toMatchObject({ list: { decided: [{ id, status: "expired", photoFileId: null }] } });
  expect(await declineVerification(id, "Too late")).toMatchObject({ ok: false });
});

it("shows the photo only while it waits for review", async () => {
  const { id, photo } = await upload();
  await signIn("mario");
  expect(await loadVerificationPhoto(id)).toEqual({ ok: true, url: expect.stringContaining(photo), backUrl: null });
  await approveVerification(id, future(30));
  expect(await loadVerificationPhoto(id)).toMatchObject({ ok: false });
});

it("audits opening the photo, once per Staff member per ten minutes, never with the number", async () => {
  const { id } = await upload();
  await signIn("ana");
  await loadVerificationPhoto(id);
  await loadVerificationPhoto(id);
  const viewed = audit.mock.calls.map(([e]) => e).filter(e => e.action === "pwd.photo_viewed");
  expect(viewed).toHaveLength(2);
  expect(viewed[0]).toMatchObject({ module: "Senior/PWD", outcome: "success", actor: { display_name: "ana Person" }, target: { type: "customer", id: "c1" } });
  // Both openings carry one identity, so the audit trail keeps a single event.
  expect(viewed[1].operationId).toBe(viewed[0].operationId);
  expect(everything()).not.toContain(NUMBER);
  audit.mockClear();
  await signIn("mario");
  await approveVerification(id, future(30));
  await signIn("ana");
  await loadVerificationPhoto(id); // refused: the photo is gone, and a refusal is not a view
  expect(audit.mock.calls.filter(([e]) => e.action === "pwd.photo_viewed")).toHaveLength(0);
});

it("loads one verification with a masked email and the order it holds, and says when it is missing", async () => {
  const { id } = await upload();
  await db.sql`insert into orders (customer_id, senior_pwd_verification_id) values ('c1', ${id})`;
  await signIn("ana");
  const detail = await loadVerificationDetail(id);
  expect(detail).toMatchObject({ ok: true, verification: { id, customerName: "Maria", customerEmailHint: "maria@...", orderId: 1, status: "pending" } });
  expect(JSON.stringify(detail)).not.toContain("maria@example.com");
  expect(await loadVerificationDetail(id + 99)).toMatchObject({ ok: false, missing: true });
  expect(await loadVerificationDetail(Number.NaN)).toMatchObject({ ok: false, missing: true });
  expect(await loadVerifications()).toMatchObject({ list: { pending: [{ id, customerEmailHint: "maria@...", orderId: 1 }] } });
});

it("lapses on the expiry date and the Customer verifies again", async () => {
  const { id } = await upload();
  await signIn("mario");
  await approveVerification(id, future(30));
  await db.sql`update senior_pwd_verifications set expires_on = (now() at time zone 'Asia/Manila')::date`;
  expect(await loadVerifications()).toMatchObject({ list: { decided: [{ id, status: "expired" }] } });
});

it("lets only a Manager override a decline or revoke an approval, with a reason; Staff are told to ask", async () => {
  const declined = await upload();
  await signIn("mario");
  await declineVerification(declined.id, "Blurry");
  await signIn("ana");
  const ask = "Only a Manager decides a Senior/PWD ID check. Request approval from a CREOMS Manager.";
  expect(await overrideVerification(declined.id, future(60), "Clear copy shown at the counter")).toEqual({ ok: false, reason: ask });

  await signIn("mario");
  expect(await overrideVerification(declined.id, future(60), " ")).toMatchObject({ ok: false, reason: "Enter a reason for the override." });
  expect(await overrideVerification(declined.id, future(60), "Clear copy shown at the counter")).toMatchObject({ ok: true, status: "approved" });
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "pwd.approved", actor: expect.objectContaining({ display_name: "mario Person" }),
    metadata: expect.objectContaining({ override: true, reason: "Clear copy shown at the counter" }) })]);

  await signIn("ana");
  expect(await revokeVerification(declined.id, "Wrong person")).toEqual({ ok: false, reason: ask });
  await signIn("mario");
  expect(await revokeVerification(declined.id, "")).toMatchObject({ ok: false });
  expect(await revokeVerification(declined.id, "Wrong person")).toMatchObject({ ok: true, status: "revoked" });
  expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "pwd.revoked", metadata: expect.objectContaining({ reason: "Wrong person" }) })]);
  expect(storefront.verificationEmails.map(e => e.status)).toEqual(["declined", "approved", "revoked"]);
  expect(everything()).not.toContain(NUMBER);
});

it("lets Staff check an ID but only a Manager-level Role approve or decline it; Staff are told to ask", async () => {
  const { id, photo } = await upload();
  await signIn("ana");
  const ask = "Only a Manager decides a Senior/PWD ID check. Request approval from a CREOMS Manager.";
  expect(await loadVerificationPhoto(id)).toMatchObject({ ok: true });
  expect(await approveVerification(id, future(30))).toEqual({ ok: false, reason: ask });
  expect(await declineVerification(id, "Blurry")).toEqual({ ok: false, reason: ask });
  expect(storefront.requests).toBe(0);
  expect(storage.files.has(photo)).toBe(true);
  await signIn("owner");
  expect(await approveVerification(id, future(30))).toMatchObject({ ok: true, status: "approved" });
  // The storefront keeps the name the ID was verified under beside the hash, and CREOMS shows it.
  expect(await loadVerificationDetail(id)).toMatchObject({ ok: true, verification: { verifiedName: "Maria", decidedByName: "owner Person" } });
});

it("keeps Admin and CEO read-only", async () => {
  const { id } = await upload();
  for (const who of ["ada"]) {
    await signIn(who);
    expect(await approveVerification(id, future(30))).toEqual({ ok: false, reason: "Your Role can only view shop work." });
    expect(await declineVerification(id, "No")).toMatchObject({ ok: false });
  }
  expect(storefront.requests).toBe(0);
});

it("does not confirm an Order while its Senior/PWD ID waits for review, and confirms after approval", async () => {
  const { id } = await upload();
  const [delivery] = await db.sql`insert into orders (customer_id, status, fulfillment_method, subtotal_in_centavos, senior_pwd_verification_id)
    values ('c1','placed','delivery',100000,${id}) returning id`;
  await signIn("mario");
  const held = { ok: false, reason: "Review the Customer's Senior/PWD ID before confirming this Order." };
  expect(await quoteDeliveryFee(delivery.id, 15000)).toEqual(held);
  await approveVerification(id, future(30));
  expect(await quoteDeliveryFee(delivery.id, 15000)).toMatchObject({ ok: true });
});

it("accepts a Delivery fee on a large subtotal once the ID is reviewed", async () => {
  const { id } = await upload();
  await signIn("mario");
  await approveVerification(id, future(30));
  const [order] = await db.sql`insert into orders (customer_id, status, fulfillment_method, subtotal_in_centavos, delivery_fee_in_centavos, senior_pwd_verification_id)
    values ('c1','placed','delivery',260000,null,${id}) returning id`;
  expect(await quoteDeliveryFee(order.id, 15000)).toMatchObject({ ok: true });
});

it("leaves the verification unchanged and the photo in place when the storefront refuses or is unreachable", async () => {
  const { id, photo } = await upload();
  await signIn("mario");
  storefront.refusal = "Storefront says no.";
  expect(await approveVerification(id, future(30))).toEqual({ ok: false, reason: "Storefront says no." });
  storefront.refusal = null; storefront.unavailable = true;
  expect(await approveVerification(id, future(30))).toMatchObject({ ok: false, reason: expect.stringContaining("could not confirm") });
  expect(storage.files.has(photo)).toBe(true);
  expect(audit).not.toHaveBeenCalled();
});

it("still succeeds when the photo cannot be deleted at once; the seven-day expiry removes it", async () => {
  const { id, photo } = await upload();
  await signIn("mario");
  storage.failRemove = true;
  storage.remove = async () => { throw new Error("down"); };
  expect(await approveVerification(id, future(30))).toEqual({ ok: true, status: "approved", photoRemoved: false });
  expect(storage.files.get(photo)?.retentionType).toBe("temporary");
});
