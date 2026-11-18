import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelPaymentOrder, markPaid, rejectPaymentProof } from "@/features/orders/actions";
import { claimPaymentReview, loadReviewManagers, reassignPaymentReview } from "@/features/orders/payment-review-actions";
import { loadPaymentReview, reviewTiming } from "@/features/orders/payment-review";
import { paymentRows } from "@/features/orders/payments";
import { DEFAULT_AUTOMATIC_CHECKS } from "@/features/settings/automatic-checks";
import { readOrderEvents } from "@/features/notifications/order-events";
import { FakePortal, FAKE_CALLBACK, FAKE_PORTAL_URL, FAKE_SYSTEM, FAKE_SECRET, portalFetch } from "./fake-portal";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";
import { FakeFileStorage } from "./fake-file-storage";
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
  await db.sql.unsafe(readFileSync("docs/db/crms-payment-allocations.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-payment-proof-reads.sql", "utf8"));
  // The migration widens the existing notifications kind check, so give it the table it widens.
  await db.sql`create table crms.notifications (id bigint generated always as identity primary key, kind text not null constraint notifications_kind_check check (kind in ('new-customer')))`;
  await db.sql.unsafe(readFileSync("docs/db/crms-payment-reviews.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-payment-reviews.sql", "utf8"));
  await db.sql`insert into crms.notifications (kind) values ('payment-review'), ('payment-review-overdue')`;
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate crms.payment_review_claims, crms.payment_reference_allocations, crms.approval_requests, crms.approval_events, order_payment_proofs, order_returns, orders, customers restart identity cascade`;
  await db.sql`update crms.approval_settings set limit_in_centavos = 500000`;
  await db.sql`insert into customers (id, full_name, email) values ('c1','Maria','maria@example.com')`;
    portal = new FakePortal(); storefront = new FakeStorefront(db.sql, undefined, storage); storage.reset(); notices.length = 0; oldDirectory = false; audit.mockClear();
  for (const [id, role] of Object.entries({ ana: "Staff/Employee", mario: "CRMS Manager", marta: "CRMS Manager", ada: "Super Admin", owner: "CEO" })) {
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

async function proofOrder(method = "gcash", reference?: string) {
  const [o] = await db.sql`insert into orders (customer_id, status, payment_method) values ('c1','awaiting payment',${method}) returning id`;
  await storefront.submitProof(o.id, reference ?? `REF-${o.id}-1`);
  return Number(o.id);
}
/** Staff reject the current proof and the Customer sends another. */
async function rejectAndResubmit(id: number, n: number) {
  for (let i = 1; i <= n; i++) {
    expect(await rejectPaymentProof(id, `Blurry ${i}`)).toMatchObject({ ok: true });
    await storefront.submitProof(id, `REF-${id}-${i + 1}`);
  }
}


/** An Order whose third proof was rejected; the third rejection happened `hoursAgo` hours ago. */
async function reviewOrder(hoursAgo = 1) {
  const [o] = await db.sql`insert into orders (customer_id, status, payment_method) values ('c1','awaiting payment','gcash') returning id`;
  const id = Number(o.id);
  await storefront.submitProof(id, `REF-${id}-1`);
  await signIn("ana");
  for (let i = 1; i <= 3; i++) {
    expect(await rejectPaymentProof(id, `Blurry ${i}`)).toMatchObject({ ok: true });
    if (i < 3) await storefront.submitProof(id, `REF-${id}-${i + 1}`);
  }
  await db.sql`update orders set payment_proof_rejected_at = now() - ${hoursAgo} * interval '1 hour' where id = ${id}`;
  return id;
}
const owner = async (id: number) => (await loadPaymentReview(db.sql, db.sql, id, 48))?.owner?.name ?? null;

describe("Manager payment review", () => {
  it("is not claimed by opening or reading it; only Managers can claim, and each claim is audited", async () => {
    const id = await reviewOrder();
    expect(await loadPaymentReview(db.sql, db.sql, id, 48)).toMatchObject({ overdue: false, owner: null });
    await signIn("ana");
    expect(await claimPaymentReview(id)).toEqual({ ok: false, reason: "Only a CREOMS Manager can take or hand over a payment review." });
    for (const actor of ["ada", "owner"]) {
      await signIn(actor);
      expect(await claimPaymentReview(id)).toMatchObject({ ok: false });
    }
    expect(await owner(id)).toBeNull();
    await signIn("mario");
    expect(await claimPaymentReview(id)).toEqual({ ok: true });
    expect(await owner(id)).toBe("mario Person");
    expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "payment_review.claimed", module: "Payments", description: expect.stringContaining("mario Person") })]);
  });

  it("reaches the Payments list with its owner and Overdue flag, and an Order with 2 rejections does not", async () => {
    const late = await reviewOrder(60), fresh = await reviewOrder(1);
    await signIn("mario"); await claimPaymentReview(late);
    const rows = await paymentRows(db.sql, new Date(), DEFAULT_AUTOMATIC_CHECKS, db.sql);
    expect(rows.find(r => r.id === late)?.review).toMatchObject({ overdue: true, owner: { id: "mario", name: "mario Person" } });
    expect(rows.find(r => r.id === fresh)?.review).toMatchObject({ overdue: false, owner: null });
    const plain = await proofOrder();
    expect((await paymentRows(db.sql, new Date(), DEFAULT_AUTOMATIC_CHECKS, db.sql)).find(r => r.id === plain)?.review).toBeUndefined();
  });

  it("is claimed by one Manager only; a second claim says who holds it", async () => {
    const id = await reviewOrder();
    await signIn("mario"); await claimPaymentReview(id);
    await signIn("marta");
    expect(await claimPaymentReview(id)).toEqual({ ok: false, reason: "mario Person already has this review." });
    expect(await owner(id)).toBe("mario Person");
  });

  it("refuses an Order that is not in review", async () => {
    const [o] = await db.sql`insert into orders (customer_id, status, payment_method) values ('c1','awaiting payment','gcash') returning id`;
    await storefront.submitProof(Number(o.id), "REF-X");
    await signIn("mario");
    expect(await claimPaymentReview(Number(o.id))).toEqual({ ok: false, reason: expect.stringContaining("no longer in Manager payment review") });
  });

  it("reassigns to another Manager with a reason, audits each owner, and refuses Staff, non-Managers and stale owners", async () => {
    const id = await reviewOrder();
    await signIn("mario"); await claimPaymentReview(id);
    expect(await loadReviewManagers()).toEqual({ ok: true, managers: expect.arrayContaining([{ id: "marta", name: "marta Person" }]) });
    expect(await reassignPaymentReview(id, "marta", "  ")).toEqual({ ok: false, reason: "Enter a reason for handing this review over." });
    expect(await reassignPaymentReview(id, "ana", "Cover")).toEqual({ ok: false, reason: "Choose a Manager with the Payments Module." });
    expect(await reassignPaymentReview(id, "mario", "Cover")).toMatchObject({ ok: false, reason: "mario Person already has this review." });
    expect(await reassignPaymentReview(id, "marta", "I am out tomorrow")).toEqual({ ok: true });
    expect(await owner(id)).toBe("marta Person");
    expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "payment_review.reassigned",
      metadata: { from: "mario Person", to: "marta Person", reason: "I am out tomorrow" } })]);
    await signIn("ana");
    expect(await reassignPaymentReview(id, "mario", "Mine")).toMatchObject({ ok: false });
    expect(await owner(id)).toBe("marta Person");
  });

  it("is Overdue past the target but cancels nothing and keeps the stock reserved until a Manager acts", async () => {
    const id = await reviewOrder(60);
    expect(await loadPaymentReview(db.sql, db.sql, id, 48)).toMatchObject({ overdue: true });
    expect(await loadPaymentReview(db.sql, db.sql, id, null)).toMatchObject({ overdue: false, deadline: null });
    const [row] = await db.sql`select status from orders where id = ${id}`;
    expect(row.status).toBe("awaiting payment");
    expect(reviewTiming(new Date("2026-01-01T00:00:00Z"), 48, new Date("2026-01-03T00:00:00Z"))).toMatchObject({ overdue: true });
    expect(reviewTiming(new Date("2026-01-01T00:00:00Z"), 48, new Date("2026-01-02T23:59:00Z"))).toMatchObject({ overdue: false });
  });

  it("ends when a Manager marks the Order paid", async () => {
    const id = await reviewOrder(60);
    await signIn("mario"); await claimPaymentReview(id);
    expect(await markPaid(id, { reason: "Found the transfer in the shop's GCash" })).toMatchObject({ ok: true, order: { status: "paid" } });
    expect(await loadPaymentReview(db.sql, db.sql, id, 48)).toBeNull();
    expect(await claimPaymentReview(id)).toMatchObject({ ok: false });
  });

  it("ends when a Manager cancels the Order", async () => {
    const id = await reviewOrder(60);
    await signIn("mario");
    expect(await cancelPaymentOrder(id)).toMatchObject({ ok: true, order: { status: "cancelled" } });
    expect(await loadPaymentReview(db.sql, db.sql, id, 48)).toBeNull();
  });

  it("alerts every Manager once at the start and again at each further target period until settled", async () => {
    const id = await reviewOrder(1);
    const keys = async (hours: number | null) => (await readOrderEvents(db.sql, null, hours)).filter(e => e.orderId === id && e.kind.startsWith("payment-review")).map(e => e.key);
    expect(await keys(48)).toEqual([`payment-review:${id}`]);
    await db.sql`update orders set payment_proof_rejected_at = now() - interval '49 hours' where id = ${id}`;
    expect(await keys(48)).toEqual([`payment-review:${id}`, `payment-review-overdue:${id}:1`]);
    await db.sql`update orders set payment_proof_rejected_at = now() - interval '100 hours' where id = ${id}`;
    expect(await keys(48)).toEqual([`payment-review:${id}`, `payment-review-overdue:${id}:2`]);
    // Switched off: the start alert stays, nothing is Overdue.
    expect(await keys(null)).toEqual([`payment-review:${id}`]);
    await db.sql`update orders set status = 'cancelled' where id = ${id}`;
    expect(await keys(48)).toEqual([]);
  });
});
