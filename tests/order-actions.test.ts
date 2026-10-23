import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelOrder, cancelPaymentOrder, confirmPickup, loadPaymentQueue, markPaid, quoteDeliveryFee,
  startPreparing, dispatchOrder, deliverOrder, getFulfilmentBoard,
} from "@/features/orders/actions";
import { loadOrder } from "@/features/orders/orders";
import { database } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/portal/staff";
import { FakePortal, FAKE_CALLBACK, FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, portalFetch } from "./fake-portal";
import { startTestDatabase, type TestDatabase } from "./ticket-database";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";

import { FakeFileStorage, PNG, JPEG, PDF } from "./fake-file-storage";

const storage = new FakeFileStorage();
vi.mock("@/lib/gateway", () => ({ get gatewayFileStorage() { return storage; } }));

function deliveryPhoto() {
  const form = new FormData();
  form.append("photo", new File([PNG], "delivery.png", { type: "image/png" }));
  return form;
}

const session = vi.hoisted(() => ({ handle: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: session.handle }) }) }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: vi.fn(() => db.sql) }));
let db: TestDatabase;
let storefront: FakeStorefront;
beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
  storage.reset();
  storefront = new FakeStorefront(db.sql);
  vi.stubGlobal("fetch", storefrontFetch(storefront));
  vi.stubEnv("CREOMS_STOREFRONT_URL", FAKE_STOREFRONT_URL);
  vi.stubEnv("CREOMS_SERVICE_SECRET", FAKE_SERVICE_SECRET);
  vi.mocked(requireModule).mockResolvedValue({ username: "ana", name: "Ana", email: "ana@example.com", role: "Staff" });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });
async function order(method = "delivery", status = "placed", payment = "cash-on-delivery") {
  const [row] = await db.sql`insert into orders (customer_id, fulfillment_method, status, payment_method)
    values ('c1', ${method}, ${status}, ${payment}) returning id`;
  return row.id as number;
}
async function signInWithModules(modules: string[]) {
  const portal = new FakePortal();
  portal.addStaff("ben", { username: "ben", name: "Ben", email: "ben@example.com", role: "Staff" }, modules);
  portal.signIn("ben");
  const verifier = "test-proof";
  const authorize = new URL("/api/integrations/authorize", FAKE_PORTAL_URL);
  authorize.search = new URLSearchParams({
    system: FAKE_SYSTEM, redirect_uri: FAKE_CALLBACK, state: "test-state",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  }).toString();
  const granted = await portal.handle(new Request(authorize));
  const code = new URL(granted.headers.get("location")!).searchParams.get("code");
  const exchange = await portal.handle(new Request(`${FAKE_PORTAL_URL}/api/integrations/exchange`, {
    method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${FAKE_SYSTEM}:${FAKE_SECRET}`).toString("base64")}` },
    body: JSON.stringify({ code, redirect_uri: FAKE_CALLBACK, state: "test-state", code_verifier: verifier }),
  }));
  session.handle = (await exchange.json()).handle;
  expect(session.handle).toBeTruthy();
  vi.stubEnv("CREOMS_DEV_BYPASS", "false");
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  const portalRequest = portalFetch(portal);
  const storefrontRequest = storefrontFetch(storefront);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return new URL(request.url).origin === FAKE_PORTAL_URL ? portalRequest(request) : storefrontRequest(request);
  });
  const actual = await vi.importActual<typeof import("@/lib/portal/staff")>("@/lib/portal/staff");
  vi.mocked(requireModule).mockImplementation(actual.requireModule);
  return portal;
}
describe("Order actions", () => {
  it("refuses direct calls when the Portal grants Payments and Fulfilment but no Orders Module", async () => {
    await signInWithModules(["Payments", "Fulfilment"]);
    for (const action of [() => quoteDeliveryFee(1, 15000), () => confirmPickup(1), () => cancelOrder(1)]) {
      await expect(action()).rejects.toMatchObject({ digest: expect.stringContaining("/no-access") });
    }
    expect(storefront.requests).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("reports an unavailable database without sending a change", async () => {
    vi.mocked(database).mockImplementationOnce(() => { throw new Error("Database offline"); });
    expect(await quoteDeliveryFee(1, 15000)).toEqual({ ok: false, reason: "Order is temporarily unavailable." });
    expect(storefront.requests).toBe(0);
  });
  it("does not report success when the storefront confirms a different fee", async () => {
    const id = await order();
    vi.stubGlobal("fetch", async () => Response.json({ id, status: "confirmed", deliveryFeeInCentavos: 1 }));
    expect(await quoteDeliveryFee(id, 15000)).toMatchObject({ ok: false, reason: expect.stringContaining("Refresh the Order") });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("does not report an uncertain response as changed or retry the write", async () => {
    const id = await order();
    storefront.unavailable = true;
    expect(await quoteDeliveryFee(id, 15000)).toMatchObject({ ok: false, reason: expect.stringContaining("Refresh the Order") });
    expect(storefront.requests).toBe(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("allows only one of two simultaneous confirmations", async () => {
    const id = await order();
    const results = await Promise.all([quoteDeliveryFee(id, 15000), quoteDeliveryFee(id, 20000)]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => !result.ok)).toMatchObject({ ok: false, reason: expect.stringMatching(/already changed/) });
  });
  it("reports missing Orders and an already confirmed Pickup without sending a change", async () => {
    for (const action of [() => quoteDeliveryFee(999, 0), () => confirmPickup(999), () => cancelOrder(999)]) {
      expect(await action()).toEqual({ ok: false, reason: "Order was not found." });
    }
    expect(await confirmPickup(await order("pickup", "confirmed"))).toEqual({ ok: false, reason: "Order already changed; refresh it before trying again." });
    expect(storefront.requests).toBe(0);
  });
  it("refuses invalid Order numbers before reading or calling the storefront", async () => {
    for (const id of [0, -1, 1.5, NaN, Infinity, "1", null]) {
      for (const action of [() => quoteDeliveryFee(id as number, 0), () => confirmPickup(id as number), () => cancelOrder(id as number)]) {
        expect(await action()).toEqual({ ok: false, reason: "Invalid Order number." });
      }
    }
    expect(storefront.requests).toBe(0);
  });
  it("checks the Orders Module on every direct call", async () => {
    const id = await order();
    vi.mocked(requireModule).mockImplementation(async () => { throw new Error("NEXT_REDIRECT:/no-access"); });
    for (const action of [() => quoteDeliveryFee(id, 15000), () => confirmPickup(id), () => cancelOrder(id)]) {
      await expect(action()).rejects.toThrow("NEXT_REDIRECT:/no-access");
    }
    expect(vi.mocked(requireModule).mock.calls).toEqual([["Orders"], ["Orders"], ["Orders"]]);
    expect(storefront.requests).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("refuses a second Staff confirmation as already changed", async () => {
    const id = await order();
    expect((await quoteDeliveryFee(id, 15000)).ok).toBe(true);
    vi.mocked(requireModule).mockResolvedValue({ username: "ben", name: "Ben", email: "ben@example.com", role: "Staff" });
    expect(await quoteDeliveryFee(id, 20000)).toEqual({ ok: false, reason: "Order already changed; refresh it before trying again." });
    expect(storefront.requests).toBe(1);
  });
  it("preserves a storefront refusal and never invalidates the Order as changed", async () => {
    const id = await order();
    storefront.refusal = "The store cannot accept this change right now.";
    expect(await quoteDeliveryFee(id, 15000)).toEqual({ ok: false, reason: storefront.refusal });
    expect(revalidatePath).not.toHaveBeenCalled();
    storefront.refusal = null;
    expect((await quoteDeliveryFee(id, 15000)).ok).toBe(true);
  });
  it("refuses invalid fees and quoting a Pickup without making a storefront request", async () => {
    const id = await order();
    for (const fee of [-1, 0.5, NaN, Infinity, "15000", undefined]) {
      expect(await quoteDeliveryFee(id, fee as number)).toEqual({ ok: false, reason: "Enter a nonnegative whole number of centavos." });
    }
    expect(await quoteDeliveryFee(await order("pickup"), 15000)).toEqual({ ok: false, reason: "Only a placed Delivery Order can be quoted." });
    expect(storefront.requests).toBe(0);
  });
  it("cancels up to preparing, and refuses dispatched, delivered and cancelled Orders", async () => {
    for (const status of ["placed", "confirmed", "awaiting payment", "paid", "preparing"]) {
      const id = await order("delivery", status);
      expect(await cancelOrder(id)).toEqual({ ok: true, order: { id, status: "cancelled", deliveryFeeInCentavos: null } });
    }
    for (const status of ["dispatched", "delivered", "cancelled"]) {
      const id = await order("delivery", status);
      const requests = storefront.requests;
      expect(await cancelOrder(id)).toEqual({ ok: false, reason: "Order already changed; refresh it before trying again." });
      expect(storefront.requests).toBe(requests);
    }
  });
  it("confirms Pickup without a fee, but refuses Delivery without one", async () => {
    const pickup = await order("pickup");
    expect(await confirmPickup(pickup)).toEqual({ ok: true, order: { id: pickup, status: "confirmed", deliveryFeeInCentavos: null } });
    const delivery = await order();
    expect(await confirmPickup(delivery)).toEqual({ ok: false, reason: "A Delivery Order needs a Delivery fee." });
  });
  it("quotes a Delivery fee in centavos and reports confirmation only after the storefront accepts", async () => {
    const id = await order();
    expect(await quoteDeliveryFee(id, 15000)).toEqual({ ok: true, order: { id, status: "confirmed", deliveryFeeInCentavos: 15000 } });
    expect(requireModule).toHaveBeenCalledWith("Orders");
  });
});

describe("Fulfilment Order actions", () => {
  it("requires a Delivery photo before contacting the storefront, including Pickup", async () => {
    for (const method of ["delivery", "pickup"]) {
      expect(await deliverOrder(await order(method, "dispatched"))).toEqual({
        ok: false, reason: "Choose exactly one Delivery photo.",
      });
    }
    expect(storefront.requests).toBe(0);
    expect(storage.files.size).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses invalid, empty and oversized photos by their bytes before uploading", async () => {
    const id = await order("delivery", "dispatched");
    for (const [bytes, reason] of [
      [PDF, "Only JPG or PNG"],
      [new Uint8Array(), "empty"],
      [new Uint8Array(5 * 1024 * 1024 + 1), "over 5 MB"],
    ] as const) {
      const form = new FormData();
      form.append("photo", new File([bytes], "delivery.png", { type: "image/png" }));
      expect(await deliverOrder(id, form)).toMatchObject({ ok: false, reason: expect.stringContaining(reason) });
    }
    const duplicate = deliveryPhoto();
    duplicate.append("photo", new File([PNG], "second.png"));
    expect(await deliverOrder(id, duplicate)).toEqual({ ok: false, reason: "Choose exactly one Delivery photo." });
    const text = new FormData();
    text.append("photo", "file-id-from-browser");
    expect(await deliverOrder(id, text)).toEqual({ ok: false, reason: "Choose exactly one Delivery photo." });
    expect(storefront.requests).toBe(0);
    expect(storage.files.size).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("uploads a real JPG or PNG and sends its File id for Delivery and Pickup", async () => {
    for (const [method, bytes, contentType] of [
      ["delivery", PNG, "image/png"], ["pickup", JPEG, "image/jpeg"],
    ] as const) {
      const id = await order(method, "dispatched");
      const form = new FormData();
      // The browser's extension and MIME claim do not decide the stored type.
      form.append("photo", new File([bytes], "handover.bin", { type: "application/octet-stream" }));
      expect(await deliverOrder(id, form)).toMatchObject({ ok: true, order: { id, status: "delivered" } });
      const fileId = [...storage.files.keys()].at(-1)!;
      expect(storage.files.get(fileId)).toMatchObject({ filename: "handover.bin", contentType, size: bytes.length });
      expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { deliveryPhotoFileId: fileId } });
    }
  });

  it("stores the Delivery photo Private and Permanent through the gateway", async () => {
    const { gatewayFileStorage } = await vi.importActual<typeof import("@/lib/gateway")>("@/lib/gateway");
    vi.spyOn(storage, "upload").mockImplementation(gatewayFileStorage.upload);
    vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test");
    vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "fake-gateway-key");
    const registrations: unknown[] = [];
    const uploads: Uint8Array[] = [];
    let confirmed = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.startsWith(FAKE_STOREFRONT_URL)) {
        expect(confirmed).toBe(true);
        return storefront.handle(request);
      }
      if (request.url === "https://bucket.test/photo" && request.method === "PUT") {
        expect(request.headers.has("authorization")).toBe(false);
        uploads.push(new Uint8Array(await request.arrayBuffer()));
        return new Response(null, { status: 200 });
      }
      expect(request.headers.get("authorization")).toBe("Bearer fake-gateway-key");
      if (request.url === "https://gateway.test/files" && request.method === "POST") {
        registrations.push(await request.json());
        return Response.json({ id: "delivery-file", uploadUrl: "https://bucket.test/photo" });
      }
      if (request.url === "https://gateway.test/files/delivery-file/confirm" && request.method === "POST") {
        confirmed = true;
        return Response.json({});
      }
      throw new Error("Unexpected file request");
    });
    const id = await order("delivery", "dispatched");
    expect(await deliverOrder(id, deliveryPhoto())).toMatchObject({ ok: true });
    expect(registrations).toEqual([{
      filename: "delivery.png", contentType: "image/png", size: PNG.length,
      visibility: "private", retentionType: "permanent",
    }]);
    expect(uploads).toEqual([PNG]);
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { deliveryPhotoFileId: "delivery-file" } });
  });

  it("accepts a photo of exactly 5 MB", async () => {
    const bytes = new Uint8Array(5 * 1024 * 1024);
    bytes.set(PNG);
    const form = new FormData();
    form.append("photo", new File([bytes], "delivery.png"));
    expect(await deliverOrder(await order("pickup", "dispatched"), form)).toMatchObject({ ok: true });
    expect(storage.files.get("file-1")?.size).toBe(5 * 1024 * 1024);
  });

  it("does not contact the storefront if the photo cannot be stored", async () => {
    storage.failUpload = true;
    expect(await deliverOrder(await order("delivery", "dispatched"), deliveryPhoto())).toEqual({
      ok: false, reason: "Delivery photo could not be stored. The Order was not marked delivered.",
    });
    expect(storefront.requests).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps delivery evidence after an accepted write whose response was lost, without retrying", async () => {
    const id = await order("delivery", "dispatched");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      await storefront.handle(new Request(input, init));
      throw new Error("Response lost after commit");
    });
    expect(await deliverOrder(id, deliveryPhoto())).toMatchObject({ ok: false, reason: expect.stringContaining("Refresh the Order") });
    expect(storefront.requests).toBe(1);
    expect(storage.files.has("file-1")).toBe(true);
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { status: "delivered", deliveryPhotoFileId: "file-1" } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("requires the storefront to confirm the photo id as well as the status", async () => {
    const id = await order("delivery", "dispatched");
    vi.stubGlobal("fetch", async () => Response.json({ id, status: "delivered", deliveryFeeInCentavos: null }));
    expect(await deliverOrder(id, deliveryPhoto())).toMatchObject({ ok: false, reason: expect.stringContaining("Refresh the Order") });
    expect(storage.files.has("file-1")).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not replace or remove an attached Delivery photo", async () => {
    const id = await order("delivery", "dispatched");
    expect((await deliverOrder(id, deliveryPhoto())).ok).toBe(true);
    expect(await deliverOrder(id, deliveryPhoto())).toMatchObject({ ok: false, reason: expect.stringContaining("already changed") });
    expect(storage.files.size).toBe(1);
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { deliveryPhotoFileId: "file-1" } });
    expect(storefront.requests).toBe(1);
  });

  it("reads legacy delivered Orders as No photo, including before the storefront schema changes", async () => {
    const id = await order("delivery", "delivered");
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { deliveryPhotoFileId: null } });
    const legacy = await startTestDatabase();
    try {
      await legacy.sql`alter table orders drop column delivery_photo_file_id`;
      await legacy.sql`insert into customers (id, full_name, email) values ('legacy', 'Maria', 'legacy@example.com')`;
      const [row] = await legacy.sql`insert into orders (customer_id, status) values ('legacy', 'delivered') returning id`;
      expect(await loadOrder(() => legacy.sql, row.id)).toMatchObject({ ok: true, order: { deliveryPhotoFileId: null } });
    } finally {
      await legacy.close();
    }
  });

  it("denies Orders and Payments Staff, and rechecks a revoked Fulfilment grant", async () => {
    const id = await order("delivery", "confirmed");
    const portal = await signInWithModules(["Orders", "Payments"]);
    for (const action of [() => startPreparing(id), () => dispatchOrder(id), () => deliverOrder(id), getFulfilmentBoard]) {
      await expect(action()).rejects.toMatchObject({ digest: expect.stringContaining("/no-access") });
    }
    expect(storefront.requests).toBe(0);
    portal.grant("ben", "Fulfilment");
    expect((await startPreparing(id)).ok).toBe(true);
    portal.revoke("ben", "Fulfilment");
    await expect(dispatchOrder(id)).rejects.toMatchObject({ digest: expect.stringContaining("/no-access") });
    await expect(deliverOrder(id, deliveryPhoto())).rejects.toMatchObject({ digest: expect.stringContaining("/no-access") });
    expect(storage.files.size).toBe(0);
    expect(storefront.requests).toBe(1);
  });

  it("refuses out-of-order moves and unpaid Orders before sending a request", async () => {
    for (const status of ["placed", "awaiting payment", "preparing", "dispatched", "delivered", "cancelled"]) {
      expect(await startPreparing(await order("delivery", status))).toMatchObject({ ok: false, reason: expect.stringContaining("not ready to prepare") });
    }
    expect((await startPreparing(await order("delivery", "confirmed", "gcash"))).ok).toBe(false);
    for (const status of ["placed", "confirmed", "awaiting payment", "paid", "dispatched", "delivered", "cancelled"]) {
      expect(await dispatchOrder(await order("delivery", status))).toMatchObject({ ok: false, reason: expect.stringContaining("Only a preparing Order") });
    }
    for (const status of ["placed", "confirmed", "awaiting payment", "paid", "preparing", "delivered", "cancelled"]) {
      expect(await deliverOrder(await order("delivery", status))).toMatchObject({ ok: false, reason: expect.stringContaining("Only a dispatched Order") });
    }
    expect(storefront.requests).toBe(0);
  });

  it("allows preparation of paid GCash and confirmed Pickup Orders", async () => {
    expect((await startPreparing(await order("delivery", "paid", "gcash"))).ok).toBe(true);
    expect((await startPreparing(await order("pickup", "confirmed"))).ok).toBe(true);
  });

  it("preserves the storefront refusal for each move without reporting success", async () => {
    storefront.refusal = "Another Staff member has already moved this Order.";
    for (const [status, move] of [["confirmed", startPreparing], ["preparing", dispatchOrder], ["dispatched", deliverOrder]] as const) {
      expect(await move(await order("delivery", status), deliveryPhoto())).toEqual({ ok: false, reason: storefront.refusal });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("only confirms one of two Staff making the same move", async () => {
    for (const [status, move] of [["confirmed", startPreparing], ["preparing", dispatchOrder], ["dispatched", deliverOrder]] as const) {
      const id = await order("delivery", status);
      const results = await Promise.all([move(id, deliveryPhoto()), move(id, deliveryPhoto())]);
      expect(results.filter(result => result.ok)).toHaveLength(1);
      expect(results.find(result => !result.ok)).toMatchObject({ reason: expect.stringMatching(/already changed/) });
    }
  });
  it("loads the board only with the Fulfilment Module", async () => {
    const id = await order("delivery", "confirmed");
    const result = await getFulfilmentBoard();
    expect(result.ok && result.board.ready).toEqual([expect.objectContaining({ id })]);
    expect(requireModule).toHaveBeenCalledWith("Fulfilment");
  });
  it("marks a dispatched Order delivered through the storefront and records its Delivery time", async () => {
    const id = await order("delivery", "dispatched");
    expect(await deliverOrder(id, deliveryPhoto())).toEqual({ ok: true, order: { id, status: "delivered", deliveryFeeInCentavos: null } });
    const { loadFulfilmentBoard } = await import("@/features/orders/fulfilment");
    const result = await loadFulfilmentBoard(() => db.sql);
    expect(result.ok && result.board.delivered).toEqual([expect.objectContaining({ id, deliveredAt: expect.any(Date) })]);
    expect(requireModule).toHaveBeenCalledWith("Fulfilment");
  });
  it("dispatches an Order being prepared through the storefront", async () => {
    const id = await order("delivery", "preparing");
    expect(await dispatchOrder(id)).toEqual({ ok: true, order: { id, status: "dispatched", deliveryFeeInCentavos: null } });
    expect(requireModule).toHaveBeenCalledWith("Fulfilment");
  });
  it("starts preparation only after the storefront confirms a payable-ready Order", async () => {
    const id = await order("delivery", "confirmed");
    expect(await startPreparing(id)).toEqual({ ok: true, order: { id, status: "preparing", deliveryFeeInCentavos: null } });
    expect(requireModule).toHaveBeenCalledWith("Fulfilment");
  });
});

describe("the Payments queue", () => {
  it("lists only submitted GCash proofs awaiting payment, oldest proof first, with amount due", async () => {
    const newer = await order("delivery", "awaiting payment");
    const older = await order("delivery", "awaiting payment");
    const textOnly = await order("delivery", "awaiting payment");
    for (const [id, submitted, screenshot] of [
      [newer, "2026-10-22T10:00:00Z", "receipts/new.png"],
      [older, "2026-10-21T10:00:00Z", "receipts/old.png"],
      [textOnly, "2026-10-23T10:00:00Z", null],
    ] as const) {
      await db.sql`update orders set payment_method = 'gcash', gcash_reference_number = ${`ref-${id}`},
        payment_proof_screenshot_pathname = ${screenshot}, payment_proof_submitted_at = ${new Date(submitted)},
        subtotal_in_centavos = 100000, delivery_fee_in_centavos = 15000 where id = ${id}`;
    }
    const paid = await order("delivery", "paid");
    const confirmed = await order("delivery", "confirmed");
    const noProof = await order("delivery", "awaiting payment");
    await db.sql`update orders set payment_method = 'gcash' where id in ${db.sql([paid, confirmed, noProof])}`;
    const cod = await order("delivery", "awaiting payment");
    await db.sql`update orders set gcash_reference_number = 'not-in-queue', payment_proof_submitted_at = now()
      where id in ${db.sql([paid, confirmed, cod])}`;

    const result = await loadPaymentQueue();
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected the Payments queue to load");
    expect(result.orders.map(o => o.id)).toEqual([older, newer, textOnly]);
    expect(result.orders[0]).toMatchObject({
      customer: { id: "c1", name: "Maria Santos" }, total: 115000,
      paymentProof: { reference: `ref-${older}`, screenshot: "receipts/old.png", submittedAt: new Date("2026-10-21T10:00:00Z") },
    });
    expect(result.orders[2].paymentProof.screenshot).toBeNull();
    expect(requireModule).toHaveBeenCalledWith("Payments");
  });
});


describe("checking a Payment proof", () => {
  it("marks paid with the signed-in Staff identity, then exposes who and when on the Order", async () => {
    const id = await order("delivery", "awaiting payment");
    await db.sql`update orders set payment_method = 'gcash', gcash_reference_number = '1234567890',
      payment_proof_submitted_at = now() where id = ${id}`;
    expect(await markPaid(id)).toMatchObject({ ok: true, order: { id, status: "paid" } });
    const result = await loadOrder(() => db.sql, id);
    expect(result).toMatchObject({ ok: true, order: {
      status: "paid", paidBy: { id: "ana", name: "Ana", at: expect.any(Date) },
    } });
    expect(await loadPaymentQueue()).toEqual({ ok: true, orders: [] });
    expect(requireModule).toHaveBeenCalledWith("Payments");
  });
});


describe("cancelling from Payments", () => {
  it("lets Payments Staff cancel through preparing and refuses later Orders", async () => {
    for (const status of ["placed", "confirmed", "awaiting payment", "paid", "preparing"]) {
      const id = await order("delivery", status);
      expect(await cancelPaymentOrder(id)).toMatchObject({ ok: true, order: { id, status: "cancelled" } });
    }
    for (const status of ["dispatched", "delivered", "cancelled"]) {
      expect(await cancelPaymentOrder(await order("delivery", status))).toEqual({
        ok: false, reason: "Order already changed; refresh it before trying again.",
      });
    }
    expect(vi.mocked(requireModule).mock.calls.every(([module]) => module === "Payments")).toBe(true);
  });
});


describe("Payments refusals", () => {
  async function proof() {
    const id = await order("delivery", "awaiting payment");
    await db.sql`update orders set payment_method = 'gcash', gcash_reference_number = '1234567890',
      payment_proof_submitted_at = now() where id = ${id}`;
    return id;
  }

  it("preserves storefront reasons for marking paid and cancelling, without reporting a change", async () => {
    const id = await proof();
    storefront.refusal = "The Customer has already cancelled this Order.";
    for (const action of [markPaid, cancelPaymentOrder]) {
      expect(await action(id)).toEqual({ ok: false, reason: storefront.refusal });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { status: "awaiting payment", paidBy: null } });
  });

  it("settles simultaneous payment checks without overwriting the first Staff attribution", async () => {
    const id = await proof();
    vi.mocked(requireModule)
      .mockResolvedValueOnce({ username: "ana", name: "Ana", email: "ana@example.com", role: "Staff" })
      .mockResolvedValueOnce({ username: "ben", name: "Ben", email: "ben@example.com", role: "Staff" });
    const results = await Promise.all([markPaid(id), markPaid(id)]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.find(r => !r.ok)).toMatchObject({ ok: false, reason: expect.stringMatching(/already changed/) });
    const result = await loadOrder(() => db.sql, id);
    const winner = results[0].ok ? { id: "ana", name: "Ana" } : { id: "ben", name: "Ben" };
    expect(result).toMatchObject({ ok: true, order: { paidBy: winner } });
    await cancelPaymentOrder(id);
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { status: "cancelled", paidBy: winner } });
  });

  it("refuses stale, non-GCash and unsubmitted proofs", async () => {
    const moved = await proof();
    expect((await markPaid(moved)).ok).toBe(true);
    expect(await markPaid(moved)).toEqual({ ok: false, reason: "Order already changed; refresh it before trying again." });
    for (const method of ["cash-on-delivery", "gcash"]) {
      const id = await order("delivery", "awaiting payment");
      await db.sql`update orders set payment_method = ${method} where id = ${id}`;
      expect(await markPaid(id)).toEqual({ ok: false, reason: "Only a GCash Order with submitted Payment proof can be marked paid." });
    }
  });

  it("reports uncertainty without retrying or reporting paid", async () => {
    const id = await proof();
    storefront.unavailable = true;
    expect(await markPaid(id)).toMatchObject({ ok: false, reason: expect.stringContaining("Refresh the Order") });
    expect(storefront.requests).toBe(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports unavailable queue data separately from an empty queue", async () => {
    expect(await loadPaymentQueue()).toEqual({ ok: true, orders: [] });
    vi.mocked(database).mockImplementationOnce(() => { throw new Error("Database offline"); });
    expect(await loadPaymentQueue()).toEqual({ ok: false, reason: "Payments are temporarily unavailable." });
  });

  it("refuses invalid and missing Order numbers for Payments actions", async () => {
    for (const action of [markPaid, cancelPaymentOrder]) {
      expect(await action(0)).toEqual({ ok: false, reason: "Invalid Order number." });
      expect(await action(999)).toEqual({ ok: false, reason: "Order was not found." });
    }
    expect(storefront.requests).toBe(0);
  });
});


describe("Payments Module access", () => {
  it("refuses Orders-only direct calls and rechecks a revoked Payments grant", async () => {
    const id = await order("delivery", "awaiting payment", "gcash");
    await db.sql`update orders set gcash_reference_number = '1234567890', payment_proof_submitted_at = now() where id = ${id}`;
    const portal = await signInWithModules(["Orders", "Fulfilment"]);
    for (const action of [loadPaymentQueue, () => markPaid(id), () => cancelPaymentOrder(id)]) {
      await expect(action()).rejects.toMatchObject({ digest: expect.stringContaining("/no-access") });
    }
    expect(storefront.requests).toBe(0);
    portal.grant("ben", "Payments");
    expect(await loadPaymentQueue()).toMatchObject({ ok: true, orders: [{ id }] });
    expect(await markPaid(id)).toMatchObject({ ok: true, order: { id, status: "paid" } });
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { paidBy: { id: "ben", name: "Ben" } } });
    portal.revoke("ben", "Payments");
    for (const action of [loadPaymentQueue, () => markPaid(id), () => cancelPaymentOrder(id)]) {
      await expect(action()).rejects.toMatchObject({ digest: expect.stringContaining("/no-access") });
    }
    expect(storefront.requests).toBe(1);
  });
});
