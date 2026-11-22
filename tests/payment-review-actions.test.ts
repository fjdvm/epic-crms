import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelPaymentOrder, markPaid, rejectPaymentProof } from "@/features/orders/actions";
import { correctProofReading, proceedDespiteFlag } from "@/features/orders/proof-read-actions";
import { proofReadsFor } from "@/features/orders/proof-read";
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
  await db.sql.unsafe(readFileSync("docs/db/crms-payment-proof-corrections.sql", "utf8"));
  // The migration widens the existing notifications kind check, so give it the table it widens.
  await db.sql`create table crms.notifications (id bigint generated always as identity primary key, kind text not null constraint notifications_kind_check check (kind in ('new-customer')))`;
  await db.sql.unsafe(readFileSync("docs/db/crms-payment-reviews.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-payment-reviews.sql", "utf8"));
  await db.sql`insert into crms.notifications (kind) values ('payment-review'), ('payment-review-overdue')`;
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate crms.payment_proof_corrections, crms.payment_proof_reads, crms.payment_review_claims, crms.payment_reference_allocations, crms.approval_requests, crms.approval_events, order_payment_proofs, order_returns, orders, customers restart identity cascade`;
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
    for (const actor of ["ada"]) {
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

describe("Correcting what the Proof reader read (#597)", () => {
  const miss = { finding: "Mismatch", read: "1000", expected: "₱1,250.00" };
  const ok = { finding: "Match", read: "x", expected: "x" };
  async function readOrder(extra?: (id: number) => Promise<void>) {
    const id = await proofOrder("gcash", "REF-DUP");
    const [p] = await db.sql`select id from order_payment_proofs where order_id = ${id}`;
    const findings = { amount: miss, date: ok, reference: ok, recipient: ok, accountNumber: ok };
    await db.sql`insert into crms.payment_proof_reads (proof_id, order_id, status, findings) values (${p.id}, ${id}, 'read', ${db.sql.json(findings)})`;
    await extra?.(id);
    return { id, proof: Number(p.id), findings };
  }
  const changes = () => db.sql`select kind, field, original_value, corrected_value, original_finding, reason, by_name from crms.payment_proof_corrections order by id`;

  it("needs a reason, keeps the original reading, and audits the correction with the person's name", async () => {
    const { proof, findings } = await readOrder();
    await signIn("ana");
    expect(await correctProofReading(proof, "amount", "1250", "  ")).toEqual({ ok: false, reason: "Enter a reason for the correction." });
    expect(await correctProofReading(proof, "amount", "", "Read the digits wrong")).toEqual({ ok: false, reason: "Enter the corrected value." });
    expect(await changes()).toHaveLength(0);
    expect(await correctProofReading(proof, "amount", "1250", "The 2 was cut off in the preview")).toEqual({ ok: true });
    expect(await changes()).toEqual([expect.objectContaining({ kind: "correction", field: "amount", original_value: "1000", corrected_value: "1250", original_finding: "Mismatch", by_name: "ana Person" })]);
    const [row] = await db.sql`select findings from crms.payment_proof_reads where proof_id = ${proof}`;
    expect(row.findings).toEqual(findings);
    const view = (await proofReadsFor(db.sql, [proof]))[proof];
    expect(view.findings!.amount.read).toBe("1000");
    expect(view.corrections).toEqual([expect.objectContaining({ kind: "correction", field: "amount", value: "1250", reason: "The 2 was cut off in the preview", by: "ana Person" })]);
    expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "payment_proof.corrected", module: "Payments", description: expect.stringContaining("ana Person") })]);
  });

  it("lets a flag be proceeded past with a reason, but not a detail that already matches", async () => {
    const { proof } = await readOrder();
    await signIn("mario");
    expect(await proceedDespiteFlag(proof, "amount", "")).toEqual({ ok: false, reason: "Enter a reason to proceed." });
    expect(await proceedDespiteFlag(proof, "date", "Fine")).toEqual({ ok: false, reason: "That detail has no flag to proceed past." });
    expect(await proceedDespiteFlag(proof, "amount", "Customer paid the rest in cash")).toEqual({ ok: true });
    expect(await changes()).toEqual([expect.objectContaining({ kind: "override", field: "amount", corrected_value: null, original_finding: "Mismatch", by_name: "mario Person" })]);
    expect(audit.mock.calls).toContainEqual([expect.objectContaining({ action: "payment_proof.flag_overridden" })]);
  });

  it("is view-only for Admin and the CEO, and refuses a proof the reader has not read", async () => {
    const { proof } = await readOrder();
    for (const who of ["ada"]) {
      await signIn(who);
      expect(await correctProofReading(proof, "amount", "1250", "Because")).toEqual({ ok: false, reason: "Your Role can only view shop work." });
      expect(await proceedDespiteFlag(proof, "amount", "Because")).toMatchObject({ ok: false });
    }
    await signIn("ana");
    expect(await correctProofReading(9999, "amount", "1", "Because")).toEqual({ ok: false, reason: "The Proof reader has not read this proof yet." });
    expect(await correctProofReading(proof, "colour", "1", "Because")).toEqual({ ok: false, reason: "Unknown detail." });
    expect(await changes()).toHaveLength(0);
  });

  it("never lets a correction bypass a Manager on a third rejection", async () => {
    const id = await reviewOrder();
    const [p] = await db.sql`select id from order_payment_proofs where order_id = ${id} order by id desc limit 1`;
    await db.sql`insert into crms.payment_proof_reads (proof_id, order_id, status, findings) values (${p.id}, ${id}, 'read', ${db.sql.json({ amount: miss, date: ok, reference: miss, recipient: ok, accountNumber: ok })})`;
    await signIn("ana");
    expect(await correctProofReading(Number(p.id), "reference", `REF-${id}-3`, "Looks right to me")).toEqual({ ok: true });
    expect(await proceedDespiteFlag(Number(p.id), "amount", "Looks right to me")).toEqual({ ok: true });
    const paid = await markPaid(id, { reason: "Corrected it" });
    expect(paid).toMatchObject({ ok: false });
    const [o] = await db.sql`select status from orders where id = ${id}`;
    expect(o.status).toBe("awaiting payment");
  });

  it("never lets a correction bypass a Manager on a reused reference", async () => {
    await proofOrder("gcash", "REF-SAME");
    const { id, proof } = await readOrder(async () => {});
    await db.sql`update order_payment_proofs set reference = 'REF-SAME' where order_id = ${id}`;
    await signIn("ana");
    expect(await correctProofReading(proof, "reference", `REF-${id}-new`, "Typo on the receipt")).toEqual({ ok: true });
    expect(await proceedDespiteFlag(proof, "amount", "Looks right to me")).toEqual({ ok: true });
    expect(await markPaid(id)).toMatchObject({ ok: false });
    const [o] = await db.sql`select status from orders where id = ${id}`;
    expect(o.status).toBe("awaiting payment");
  });
});
