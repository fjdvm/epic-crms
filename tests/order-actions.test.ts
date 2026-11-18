import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelOrder, cancelOrderItems, loadCancellableOrderItems, cancelPaymentOrder, confirmPickup as realConfirm, loadPaymentQueue, markPaid, quoteDeliveryFee as realQuote,
  resendConfirmationEmail, loadPackingSlip, startPreparing, dispatchOrder, deliverOrder, getFulfilmentBoard, reconcileDeliveryPhoto,
} from "@/features/orders/actions";
import { loadOrder } from "@/features/orders/orders";
import { database } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/portal/staff";
import { FakePortal, FAKE_CALLBACK, FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, portalFetch } from "./fake-portal";
import { startTestDatabase, type TestDatabase } from "./ticket-database";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";

import { FakeFileStorage, PNG } from "./fake-file-storage";

const audit = vi.hoisted(() => vi.fn<import("@/lib/audit-trail").AuditTrail>(async () => {}));
const storage = new FakeFileStorage();
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit, get gatewayFileStorage() { return storage; } }));
vi.mock("@/features/files/storage", () => ({
  storageUrl: (url: string) => url,
  directFileStorage: { view: vi.fn((id: string) => storage.view(id)) },
}));

function deliveryPhoto(bytes: Uint8Array = PNG, staffId = "ana") {
  const form = new FormData();
  form.set("photo", storage.readyEvidence("Fulfilment", bytes, staffId));
  return form;
}

const session = vi.hoisted(() => ({ handle: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: session.handle }) }) }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: vi.fn(() => db.sql) }));
let db: TestDatabase;

/** The total Staff would have seen on screen: what the database holds for the Order. */
async function shownTotal(id: number, fee: number) {
  const [row] = Number.isSafeInteger(id) ? await db.sql`select subtotal_in_centavos as s, coalesce((to_jsonb(o) ->> 'discount_in_centavos')::int, 0) as d from orders o where id = ${id}` : [];
  return row ? row.s - row.d + fee : 0;
}
const quoteDeliveryFee = async (id: number, fee: number, choice?: Parameters<typeof realQuote>[3]) => realQuote(id, fee, await shownTotal(id, fee), choice);
const confirmPickup = async (id: number, choice?: Parameters<typeof realConfirm>[2]) => realConfirm(id, await shownTotal(id, 0), choice);
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
  vi.mocked(requireModule).mockResolvedValue({ id: "ana", username: "ana", name: "Ana", email: "ana@example.com", role: "Staff" });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });
async function order(method = "delivery", status = "placed", payment = "cash-on-delivery") {
  const [row] = await db.sql`insert into orders (customer_id, fulfillment_method, status, payment_method)
    values ('c1', ${method}, ${status}, ${payment}) returning id`;
  return row.id as number;
}
async function signInWithModules(modules: string[]) {
  const portal = new FakePortal();
  portal.addStaff("ben", { id: "ben", username: "ben", name: "Ben", email: "ben@example.com", role: "Staff" }, modules);
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
  it.each(["Admin", "CEO"])("keeps packing read-only for %s while allowing packing-slip reads", async role => {
    const id = await order("delivery", "paid", "gcash");
    vi.mocked(requireModule).mockResolvedValue({ id: "owner", username: "owner", name: "Owner", email: "owner@example.com", role });
    expect(await startPreparing(id)).toMatchObject({ ok: false, reason: "Your Role can only view shop work." });
    expect(await loadPackingSlip(id)).toMatchObject({ ok: true, slip: { fulfillmentMethod: "delivery", packedBy: null } });
    expect(storefront.requests).toBe(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("does not accept packing confirmation without the expected Staff identity and time", async () => {
    const id = await order("pickup", "confirmed");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id, status: "preparing", deliveryFeeInCentavos: null, packedBy: { id: "someone-else", name: "Other", at: "invalid" } })));
    expect(await startPreparing(id)).toMatchObject({ ok: false, reason: expect.stringContaining("did not confirm") });
    expect(audit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns the snapshotted address and whole items in a Delivery packing slip", async () => {
    const id = await order("delivery", "paid", "gcash");
    await db.sql`insert into order_delivery_addresses (order_id, street, barangay, city, province, postal_code) values (${id}, '10 Main St', 'San Jose', 'Antipolo', 'Rizal', '1870')`;
    await db.sql`insert into order_lines (order_id, product_name, size_label, quantity) values (${id}, 'Halaya', '500g', 3)`;
    expect(await loadPackingSlip(id)).toMatchObject({ ok: true, slip: { id, customer: { name: "Maria Santos" }, fulfillmentMethod: "delivery", lines: [{ product: "Halaya", size: "500g", quantity: 3 }], address: { street: "10 Main St", city: "Antipolo" }, packedBy: null } });
  });

  it("packs under the Portal Staff identity once and exposes the packing slip", async () => {
    const id = await order("pickup", "confirmed");
    await db.sql`insert into order_lines (order_id, product_name, size_label, quantity) values (${id}, 'Halaya', '250g', 2)`;
    expect(await startPreparing(id)).toMatchObject({ ok: true, order: { status: "preparing" } });
    expect(await loadPackingSlip(id)).toMatchObject({ ok: true, slip: { id, fulfillmentMethod: "pickup", address: null,
      lines: [{ product: "Halaya", size: "250g", quantity: 2 }], packedBy: { id: "ana", name: "Ana", at: expect.any(Date) } } });
    expect(await startPreparing(id)).toMatchObject({ ok: false });
    expect(storefront.packedEvents).toEqual([{ action: "order.packed", actor: { id: "ana", name: "Ana" }, at: expect.any(String) }]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("accepts a ₱0 Delivery fee on any subtotal and audits it as free delivery", async () => {
    const id = await order();
    await db.sql`update orders set subtotal_in_centavos = 250001 where id = ${id}`;
    expect(await quoteDeliveryFee(id, 0)).toMatchObject({ ok: true, order: { status: "confirmed", deliveryFeeInCentavos: 0 } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "order.confirmed", description: expect.stringContaining("free delivery") }));
  });

  it("quotes a Delivery fee on a subtotal over ₱2,500 instead of refusing", async () => {
    const id = await order();
    await db.sql`update orders set subtotal_in_centavos = 300000 where id = ${id}`;
    expect(await quoteDeliveryFee(id, 15000)).toMatchObject({ ok: true, order: { deliveryFeeInCentavos: 15000 } });
  });

  it("refuses a confirmation whose total no longer matches and saves nothing", async () => {
    const pickup = await order("pickup");
    await db.sql`update orders set subtotal_in_centavos = 100000 where id = ${pickup}`;
    expect(await realConfirm(pickup, 90_000)).toMatchObject({ ok: false, reason: expect.stringContaining("The total is now ₱1000.00") });
    const delivery = await order();
    await db.sql`update orders set subtotal_in_centavos = 100000 where id = ${delivery}`;
    expect(await realQuote(delivery, 15_000, 100_000)).toMatchObject({ ok: false, reason: expect.stringContaining("₱1150.00") });
    expect(storefront.requests).toBe(0);
    expect(audit).not.toHaveBeenCalled();
    expect(await db.sql`select status from orders where id in ${db.sql([pickup, delivery])}`).toEqual([{ status: "placed" }, { status: "placed" }]);
  });

  it("confirms with subtotal, discount, fee and total, and audits order.confirmed with the amounts and Staff", async () => {
    const id = await order();
    await db.sql`update orders set subtotal_in_centavos = 100000 where id = ${id}`;
    expect(await realQuote(id, 15_000, 115_000)).toMatchObject({ ok: true, order: { status: "confirmed", deliveryFeeInCentavos: 15_000 } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "order.confirmed", actor: { type: "user", id: "ana", display_name: "Ana" },
      metadata: { subtotal_in_centavos: 100000, discount_in_centavos: 0, delivery_fee_in_centavos: 15_000, total_in_centavos: 115_000 },
    }));
    expect(await realQuote(id, 15_000, 115_000)).toMatchObject({ ok: false, reason: expect.stringMatching(/already changed/) });
  });

  describe("free delivery locked at confirmation (#580)", () => {
    const qualifying = async (threshold = 250_000) => {
      const id = await order();
      await db.sql`update orders set subtotal_in_centavos = 300000, free_delivery = true, free_delivery_threshold_in_centavos = ${threshold} where id = ${id}`;
      return id;
    };

    it("refuses a fee on a qualifying Order in plain words, with no event and no storefront call", async () => {
      const id = await qualifying();
      expect(await quoteDeliveryFee(id, 15_000)).toEqual({ ok: false, reason: expect.stringContaining("locked at ₱0.00") });
      expect(storefront.requests).toBe(0);
      expect(audit).not.toHaveBeenCalled();
      expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { status: "placed" } });
    });

    it("confirms a qualifying Order at ₱0 and audits the benefit with the threshold that applied", async () => {
      const id = await qualifying();
      expect(await quoteDeliveryFee(id, 0)).toMatchObject({ ok: true, order: { status: "confirmed", deliveryFeeInCentavos: 0 } });
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({
        action: "order.confirmed",
        metadata: { subtotal_in_centavos: 300000, discount_in_centavos: 0, delivery_fee_in_centavos: 0, total_in_centavos: 300000, free_delivery_applied: true, free_delivery_threshold_in_centavos: 250_000 },
      }));
    });

    it("lets the saved rule decide, not the current threshold", async () => {
      const id = await qualifying(250_000);
      await db.sql`update orders set subtotal_in_centavos = 100000 where id = ${id}`;
      expect(await quoteDeliveryFee(id, 15_000)).toMatchObject({ ok: false });
      expect(await quoteDeliveryFee(id, 0)).toMatchObject({ ok: true });
    });

    it("does not lock an Order saved as not qualifying: a fee is needed, and ₱0 by hand is accepted", async () => {
      const id = await order();
      await db.sql`update orders set subtotal_in_centavos = 300000, free_delivery = false, free_delivery_threshold_in_centavos = 500000 where id = ${id}`;
      expect(await quoteDeliveryFee(id, Number.NaN)).toMatchObject({ ok: false });
      expect(await quoteDeliveryFee(id, 0)).toMatchObject({ ok: true, order: { deliveryFeeInCentavos: 0 } });
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "order.confirmed", metadata: expect.not.objectContaining({ free_delivery_applied: true }) }));
    });

    it("has no fee for a Pickup Order", async () => {
      const id = await order("pickup");
      expect(await confirmPickup(id)).toMatchObject({ ok: true, order: { status: "confirmed" } });
      expect(await quoteDeliveryFee(await order("pickup"), 0)).toMatchObject({ ok: false });
    });
  });

  it("refuses a Delivery fee quote on a Pickup Order", async () => {
    const id = await order("pickup");
    expect(await quoteDeliveryFee(id, 0)).toMatchObject({ ok: false });
    expect(storefront.requests).toBe(0);
  });

  it.each(["confirmed", "awaiting payment", "paid", "preparing"])("requires a new quote after cancelling an item from a Free delivery Order in %s", async status => {
    const id = await order("delivery", status);
    if (status === "paid") vi.mocked(requireModule).mockResolvedValue({ id: "ana", username: "ana", name: "Ana", email: "ana@example.com", role: "CREOMS Manager" });
    await db.sql`update orders set subtotal_in_centavos = 250001, delivery_fee_in_centavos = 0 where id = ${id}`;
    await db.sql`insert into order_lines (order_id, product_name, quantity, price_in_centavos) values (${id}, 'Keep', 1, 250000)`;
    const [line] = await db.sql`insert into order_lines (order_id, product_name, quantity, price_in_centavos) values (${id}, 'Cancel', 1, 1) returning id`;
    const candidates = await loadCancellableOrderItems(id);
    expect(candidates).toMatchObject({ ok: true, items: [{ product: "Keep" }, { id: line.id, product: "Cancel" }] });
    expect(await quoteDeliveryFee(id, 19000)).toMatchObject({ ok: false });
    expect(await cancelOrderItems(id, [line.id])).toMatchObject({ ok: true, order: { status, deliveryFeeInCentavos: null } });
    const detail = await loadOrder(() => db.sql, id);
    expect(detail).toMatchObject({ ok: true, order: { status, subtotal: 250000 } });
    expect(await quoteDeliveryFee(id, 19000)).toMatchObject({ ok: true, order: { status, deliveryFeeInCentavos: 19000 } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "order.items_cancelled", actor: { type: "user", id: "ana", display_name: "Ana" } }));
  });

  it("keeps the Order unchanged when item cancellation is refused and asks a Manager for paid items", async () => {
    const id = await order("delivery", "paid");
    expect(await cancelOrderItems(id, [1])).toMatchObject({ ok: false, reason: expect.stringContaining("Request approval") });
    expect(storefront.requests).toBe(0);
    for (const lineIds of [[], [1, 1], [0], [NaN]]) {
      expect(await cancelOrderItems(id, lineIds)).toMatchObject({ ok: false });
    }
    vi.mocked(requireModule).mockResolvedValue({ id: "ana", username: "ana", name: "Ana", email: "ana@example.com", role: "CREOMS Manager" });
    storefront.refusal = "Storefront refused the change.";
    expect(await cancelOrderItems(id, [1])).toEqual({ ok: false, reason: storefront.refusal });
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { status: "paid" } });
    expect(audit).not.toHaveBeenCalled();
  });

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
    vi.mocked(requireModule).mockResolvedValue({ id: "ben", username: "ben", name: "Ben", email: "ben@example.com", role: "Staff" });
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

const COURIER = { courier: "Lalamove", trackingUrl: "https://share.lalamove.com/abc" };
const dispatch = (id: number) => dispatchOrder(id, COURIER);

describe("Courier details at dispatch", () => {
  it("refuses a Delivery dispatch without a courier or an https link, before the storefront", async () => {
    const id = await order("delivery", "preparing");
    const requests = storefront.requests;
    for (const input of [undefined, { ...COURIER, courier: "" }, { ...COURIER, courier: "Other" }, { ...COURIER, trackingUrl: "" },
      { ...COURIER, trackingUrl: "http://share.lalamove.com/abc" }, { ...COURIER, trackingUrl: "not a link" }]) {
      expect((await dispatchOrder(id, input)).ok).toBe(false);
    }
    expect(storefront.requests).toBe(requests);
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { status: "preparing" } });
  });
  it("sends the booking with optional rider details and audits only the courier", async () => {
    const id = await order("delivery", "preparing");
    expect(await dispatchOrder(id, { ...COURIER, courier: "Grab", riderName: " Juan ", riderPhone: "0917 123 4567", riderPlate: "" })).toEqual({ ok: true, order: { id, status: "dispatched", deliveryFeeInCentavos: null } });
    expect(storefront.couriers.get(id)).toEqual({ name: "Grab", trackingUrl: COURIER.trackingUrl, riderName: "Juan", riderPhone: "0917 123 4567" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "order.dispatched", metadata: { courier: "Grab" } }));
    expect(JSON.stringify(audit.mock.calls)).not.toContain("0917");
  });
  it("dispatches a Pickup Order without a courier", async () => {
    const id = await order("pickup", "preparing");
    expect(await dispatch(id)).toEqual({ ok: true, order: { id, status: "dispatched", deliveryFeeInCentavos: null } });
    expect(storefront.couriers.has(id)).toBe(false);
    expect(audit).toHaveBeenCalledWith(expect.not.objectContaining({ metadata: expect.anything() }));
  });
  it("reports the storefront's refusal without auditing", async () => {
    const id = await order("delivery", "preparing");
    storefront.refusal = "Another Staff member has already moved this Order.";
    expect(await dispatch(id)).toEqual({ ok: false, reason: storefront.refusal });
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("Fulfilment Order actions", () => {
  it("reconciles only the photo recorded on a delivered or received Order", async () => {
    const id = await order("delivery", "dispatched");
    storefront.refusal = "Delivery refused.";
    await deliverOrder(id, deliveryPhoto());
    expect((await reconcileDeliveryPhoto(id)).ok).toBe(false);
    expect((await reconcileDeliveryPhoto(999)).ok).toBe(false);
    expect(await reconcileDeliveryPhoto(0)).toEqual({ ok: false, reason: "Invalid Order number." });
    storefront.refusal = null;
    await deliverOrder(id, deliveryPhoto());
    // Simulate a failed promotion of the committed File; refused file-1 is still unrelated.
    storage.files.get("file-2")!.retentionType = "temporary";
    storage.failPromote = true;
    expect((await reconcileDeliveryPhoto(id)).ok).toBe(false);
    expect(storage.files.get("file-2")?.retentionType).toBe("temporary");
    storage.failPromote = false;
    await db.sql`update orders set status = 'received' where id = ${id}`;
    expect(await reconcileDeliveryPhoto(id)).toEqual({ ok: true });
    expect(await reconcileDeliveryPhoto(id)).toEqual({ ok: true });
    expect(storage.files.get("file-1")?.retentionType).toBe("temporary");
    expect(storage.files.get("file-2")?.retentionType).toBe("permanent");
    expect(storefront.requests).toBe(2);
  });

  it("leaves Temporary evidence after malformed responses and transport failures without retrying", async () => {
    const id = await order("delivery", "dispatched");
    vi.mocked(revalidatePath).mockClear();
    const replies = [() => new Response("invalid JSON"), () => new Response(null, { status: 204 }),
      () => new Response(null, { status: 503 }), () => { throw new Error("Connection lost"); }];
    for (const reply of replies) {
      const send = vi.fn(async () => reply());
      vi.stubGlobal("fetch", send);
      expect(await deliverOrder(id, deliveryPhoto())).toMatchObject({ ok: false, reason: expect.stringContaining("Refresh the Order") });
      expect(send).toHaveBeenCalledTimes(1);
    }
    expect([...storage.files.values()].map(file => file.retentionType)).toEqual(["temporary", "temporary", "temporary", "temporary"]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not repeat a confirmed delivery when making its photo Permanent fails", async () => {
    const id = await order("delivery", "dispatched");
    storage.failPromote = true;
    expect(await deliverOrder(id, deliveryPhoto())).toMatchObject({ ok: false, reason: expect.stringContaining("The Order was marked delivered") });
    expect(storefront.requests).toBe(1);
    expect(storage.files.get("file-1")).toMatchObject({ retentionType: "temporary" });
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { status: "delivered", deliveryPhotoFileId: "file-1" } });
  });

  it("does not claim the photo is Permanent when the gateway fails to confirm promotion", async () => {
    const { gatewayFileStorage } = await vi.importActual<typeof import("@/lib/gateway")>("@/lib/gateway");
    vi.spyOn(storage, "promote").mockImplementation(gatewayFileStorage.promote);
    vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test");
    vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "fake-gateway-key");
    const send = storefrontFetch(storefront);
    for (const reply of [{}, { id: "another-file", retentionType: "permanent", expiresAt: null },
      { id: "file-1", retentionType: "temporary", expiresAt: "2026-11-02T00:00:00Z" }]) {
      storage.reset();
      const id = await order("delivery", "dispatched");
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        return request.url.startsWith(FAKE_STOREFRONT_URL) ? send(request) : Promise.resolve(Response.json(reply));
      });
      expect(await deliverOrder(id, deliveryPhoto())).toMatchObject({ ok: false, reason: expect.stringContaining("The Order was marked delivered") });
    }
    expect(storefront.requests).toBe(3);
  });

  it("keeps a refused Delivery photo Temporary and says the Order was not changed", async () => {
    const id = await order("delivery", "dispatched");
    storefront.refusal = "The Order is no longer dispatched.";
    expect(await deliverOrder(id, deliveryPhoto())).toEqual({ ok: false, reason: storefront.refusal });
    expect(storage.files.get("file-1")).toMatchObject({ retentionType: "temporary" });
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { status: "dispatched", deliveryPhotoFileId: null } });
    expect(storefront.requests).toBe(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

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

  it("refuses raw bytes, bare File ids and multiple references before contacting the storefront", async () => {
    const id = await order("delivery", "dispatched");
    const bytes = new FormData(); bytes.set("photo", new File([PNG], "delivery.png"));
    const bare = new FormData(); bare.set("photo", "file-from-browser");
    const duplicate = deliveryPhoto(); duplicate.append("photo", "second-reference");
    for (const form of [bytes, bare, duplicate]) {
      expect(await deliverOrder(id, form)).toEqual({ ok: false, reason: "Choose exactly one Delivery photo." });
    }
    expect(storefront.requests).toBe(0);
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
    expect(storage.files.get("file-1")).toMatchObject({ retentionType: "temporary" });
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { status: "delivered", deliveryPhotoFileId: "file-1" } });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await reconcileDeliveryPhoto(id)).toEqual({ ok: true });
    expect(storage.files.get("file-1")).toMatchObject({ retentionType: "permanent" });
    expect(storefront.requests).toBe(1);
  });

  it("requires the storefront to confirm the photo id as well as the status", async () => {
    const id = await order("delivery", "dispatched");
    for (const deliveryPhotoFileId of [undefined, "another-photo"]) {
      const send = vi.fn(async () => Response.json({ id, status: "delivered", deliveryFeeInCentavos: null, deliveryPhotoFileId }));
      vi.stubGlobal("fetch", send);
      expect(await deliverOrder(id, deliveryPhoto())).toMatchObject({ ok: false, reason: expect.stringContaining("Refresh the Order") });
      expect(send).toHaveBeenCalledTimes(1);
    }
    expect([...storage.files.values()].map(file => file.retentionType)).toEqual(["temporary", "temporary"]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not replace or remove an attached Delivery photo", async () => {
    const id = await order("delivery", "dispatched");
    expect((await deliverOrder(id, deliveryPhoto())).ok).toBe(true);
    expect(await deliverOrder(id, deliveryPhoto())).toMatchObject({ ok: false, reason: expect.stringContaining("already changed") });
    expect(storage.files.get("file-1")?.retentionType).toBe("permanent");
    expect(storage.files.get("file-2")?.retentionType).toBe("temporary");
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
      expect(await loadOrder(() => legacy.sql, row.id)).toMatchObject({ ok: true, order: { deliveryPhotoFileId: null, deliveryPhotoRemovedAt: null } });
    } finally {
      await legacy.close();
    }
  }, 30_000);

  it("reads a removed Delivery photo as removed, not as No photo", async () => {
    const id = await order("delivery", "delivered");
    await db.sql`update orders set delivery_photo_file_id = null, delivery_photo_removed_at = '2026-10-30T00:00:00Z' where id = ${id}`;
    expect(await loadOrder(() => db.sql, id)).toMatchObject({
      ok: true, order: { deliveryPhotoFileId: null, deliveryPhotoRemovedAt: new Date("2026-10-30T00:00:00Z") },
    });
    const never = await order("delivery", "delivered");
    expect(await loadOrder(() => db.sql, never)).toMatchObject({ ok: true, order: { deliveryPhotoRemovedAt: null } });
  });

  it("denies Orders and Payments Staff, and rechecks a revoked Fulfilment grant", async () => {
    const id = await order("delivery", "confirmed");
    const portal = await signInWithModules(["Orders", "Payments"]);
    for (const action of [() => startPreparing(id), () => dispatchOrder(id), () => deliverOrder(id), () => reconcileDeliveryPhoto(id), getFulfilmentBoard]) {
      await expect(action()).rejects.toMatchObject({ digest: expect.stringContaining("/no-access") });
    }
    expect(storefront.requests).toBe(0);
    portal.grant("ben", "Fulfilment");
    expect((await startPreparing(id)).ok).toBe(true);
    portal.revoke("ben", "Fulfilment");
    await expect(dispatchOrder(id)).rejects.toMatchObject({ digest: expect.stringContaining("/no-access") });
    await expect(deliverOrder(id)).rejects.toMatchObject({ digest: expect.stringContaining("/no-access") });
    await expect(reconcileDeliveryPhoto(id)).rejects.toMatchObject({ digest: expect.stringContaining("/no-access") });
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
    for (const [status, move] of [["confirmed", startPreparing], ["preparing", (id: number) => dispatch(id)], ["dispatched", deliverOrder]] as const) {
      expect(await move(await order("delivery", status), deliveryPhoto())).toEqual({ ok: false, reason: storefront.refusal });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("only confirms one of two Staff making the same move", async () => {
    for (const [status, move] of [["confirmed", startPreparing], ["preparing", (id: number) => dispatch(id)], ["dispatched", deliverOrder]] as const) {
      const id = await order("delivery", status);
      const results = await Promise.all([move(id, deliveryPhoto()), move(id, deliveryPhoto())]);
      expect(results.filter(result => result.ok)).toHaveLength(1);
      expect(results.find(result => !result.ok)).toMatchObject({ reason: expect.stringMatching(/already changed/) });
    }
  });
  it("loads the board only with the Fulfilment Module", async () => {
    const id = await order("delivery", "confirmed");
    const result = await getFulfilmentBoard();
    expect(result.ok && result.board.orders).toEqual([expect.objectContaining({ id })]);
    expect(requireModule).toHaveBeenCalledWith("Fulfilment");
  });
  it("marks a dispatched Order delivered through the storefront and records its Delivery time", async () => {
    const id = await order("delivery", "dispatched");
    expect(await deliverOrder(id, deliveryPhoto())).toEqual({ ok: true, order: { id, status: "delivered", deliveryFeeInCentavos: null } });
    const { loadFulfilmentBoard } = await import("@/features/orders/fulfilment");
    const result = await loadFulfilmentBoard(() => db.sql);
    expect(result.ok && result.board.orders).toEqual([expect.objectContaining({ id, deliveredAt: expect.any(Date) })]);
    expect(requireModule).toHaveBeenCalledWith("Fulfilment");
    expect(storage.files.get("file-1")).toMatchObject({ retentionType: "permanent" });
  });
  it("dispatches an Order being prepared through the storefront", async () => {
    const id = await order("delivery", "preparing");
    expect(await dispatch(id)).toEqual({ ok: true, order: { id, status: "dispatched", deliveryFeeInCentavos: null } });
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
    await db.sql`update orders set payment_proof_file_id = 'file-1' where id = ${newer}`;
    const withFile = await loadPaymentQueue();
    if (!withFile.ok) throw new Error("expected the Payments queue to load");
    expect(withFile.orders.find(o => o.id === newer)!.paymentProof.screenshot).toBe(`/api/orders/${newer}/payment-proof`);
    expect(withFile.orders.find(o => o.id === older)!.paymentProof.screenshot).toBe("receipts/old.png");
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
      .mockResolvedValueOnce({ id: "ana", username: "ana", name: "Ana", email: "ana@example.com", role: "Staff" })
      .mockResolvedValueOnce({ id: "ben", username: "ben", name: "Ben", email: "ben@example.com", role: "Staff" });
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
      expect(await markPaid(id)).toEqual({ ok: false, reason: "Only an Order paid by GCash, Maya or bank transfer with submitted Payment proof can be marked paid." });
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


describe("Order and Payment Audit Events", () => {
  const cases = [
    { action: "order.confirmed", module: "Orders", method: "delivery", status: "placed", run: (id: number) => quoteDeliveryFee(id, 15000), description: "Ana quoted a Delivery fee of ₱150.00 and confirmed Order #" },
    { action: "order.confirmed", module: "Orders", method: "pickup", status: "placed", run: confirmPickup, description: "Ana confirmed Order #" },
    { action: "order.cancelled", module: "Orders", method: "delivery", status: "confirmed", run: cancelOrder, description: "Ana cancelled Order #" },
    { action: "order.cancelled", module: "Payments", method: "delivery", status: "awaiting payment", run: cancelPaymentOrder, description: "Ana cancelled Order #" },
    { action: "payment.marked_paid", module: "Payments", method: "delivery", status: "awaiting payment", run: markPaid, description: "Ana marked Order #" },
  ];
  async function ready(test: typeof cases[number]) {
    const id = await order(test.method, test.status, "gcash");
    await db.sql`update orders set payment_proof_submitted_at = now() where id = ${id}`;
    vi.mocked(requireModule).mockResolvedValue({ id: "portal-user-123", username: "ana", name: "Ana", email: "ana@example.com", role: "Staff" });
    return id;
  }
  it.each(cases)("records exactly one $action event in $module, including after a retry", async test => {
    const id = await ready(test);
    expect((await test.run(id)).ok).toBe(true);
    expect(audit).toHaveBeenCalledExactlyOnceWith({
      action: test.action, module: test.module, outcome: "success",
      actor: { type: "user", id: "portal-user-123", display_name: "Ana" },
      target: { type: "order", id: String(id), display_name: `Order #${id}` },
      description: `${test.description}${id}${test.action === "payment.marked_paid" ? " paid" : ""}.`,
      occurred_at: expect.any(String), operationId: `order:${id}:${test.action}`,
      ...(test.action === "order.confirmed" ? { metadata: expect.objectContaining({ total_in_centavos: expect.any(Number) }) } : {}),
    });
    expect((await test.run(id)).ok).toBe(false);
    expect(audit).toHaveBeenCalledTimes(1);
  });
  it.each(cases)("keeps the $action change when the audit trail fails", async test => {
    const id = await ready(test);
    const error = new Error("audit offline");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    audit.mockRejectedValueOnce(error);
    expect((await test.run(id)).ok).toBe(true);
    expect(logged).toHaveBeenCalledWith("CREOMS Audit Event could not be recorded", error);
    expect((await test.run(id)).ok).toBe(false);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/orders/${id}`);
    const result = await loadOrder(() => db.sql, id);
    expect(result).toMatchObject({ ok: true, order: { status: test.action === "payment.marked_paid" ? "paid" : test.action === "order.cancelled" ? "cancelled" : "confirmed" } });
  });
  it.each(cases)("does not report a successful $action event after storefront refusal", async test => {
    const id = await ready(test);
    storefront.refusal = "Order already changed.";
    expect((await test.run(id)).ok).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });
  it("records only the winner of concurrent confirmations", async () => {
    const id = await ready(cases[0]);
    const results = await Promise.all([quoteDeliveryFee(id, 15000), quoteDeliveryFee(id, 20000)]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });
  it("does not audit Payment queue reads", async () => {
    await loadPaymentQueue();
    expect(audit).not.toHaveBeenCalled();
  });

});

describe("Fulfilment Audit Events", () => {
  const cases = [
    { status: "preparing", next: "dispatched", run: dispatch, actions: ["order.dispatched"] },
    { status: "dispatched", next: "delivered", run: (id: number) => deliverOrder(id, deliveryPhoto()), actions: ["order.delivered", "order.delivery_photo_attached"] },
  ];
  it.each(cases)("audits $next exactly once across retries", async test => {
    const id = await order("delivery", test.status);
    vi.mocked(requireModule).mockResolvedValue({ id: "portal-user-123", username: "ana", name: "Ana", email: "ana@example.com", role: "Staff" });
    expect((await test.run(id)).ok).toBe(true);
    expect(audit.mock.calls.map(([event]) => event.action)).toEqual(test.actions);
    for (const action of test.actions) {
      expect(audit).toHaveBeenCalledWith({
        action, module: "Fulfilment", outcome: "success",
        actor: { type: "user", id: "portal-user-123", display_name: "Ana" },
        target: { type: "order", id: String(id), display_name: `Order #${id}` },
        description: expect.stringMatching(new RegExp(`Ana.*Order #${id}`)),
        ...(action === "order.dispatched" ? { metadata: { courier: "Lalamove" } } : {}),
        occurred_at: expect.any(String), operationId: `order:${id}:${action}`,
      });
    }
    expect((await test.run(id)).ok).toBe(false);
    expect(audit).toHaveBeenCalledTimes(test.actions.length);
  });
  it.each(cases)("preserves $next when audit fails", async test => {
    const id = await order("delivery", test.status);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    test.actions.forEach(() => audit.mockRejectedValueOnce(new Error("offline")));
    expect((await test.run(id)).ok).toBe(true);
    expect(logged).toHaveBeenCalledTimes(test.actions.length);
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { status: test.next } });
    expect(revalidatePath).toHaveBeenCalledWith(`/orders/${id}`);
  });
  it.each(cases)("does not audit refused $next", async test => {
    const id = await order("delivery", test.status);
    storefront.refusal = "Already changed";
    expect((await test.run(id)).ok).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });
  it("audits delivery and attachment even when photo promotion fails, without duplicating on reconciliation", async () => {
    const id = await order("delivery", "dispatched");
    storage.failPromote = true;
    expect((await deliverOrder(id, deliveryPhoto())).ok).toBe(false);
    expect(audit).toHaveBeenCalledTimes(2);
    storage.failPromote = false;
    expect(await reconcileDeliveryPhoto(id)).toEqual({ ok: true });
    expect((await deliverOrder(id, deliveryPhoto())).ok).toBe(false);
    expect(audit).toHaveBeenCalledTimes(2);
  });
});

describe("resendConfirmationEmail", () => {
  async function failedEmail(reason = "mailbox full") {
    const id = await order("delivery", "confirmed");
    await db.sql`insert into order_email_outcomes (order_id, kind, status, reason) values (${id}, 'confirmation', 'failed', ${reason})`;
    return id;
  }
  const outcome = async (id: number) => (await db.sql`select status, reason from order_email_outcomes where order_id = ${id}`)[0];

  it("resends, clears the failure and audits the person's name", async () => {
    const id = await failedEmail();
    expect(await resendConfirmationEmail(id)).toEqual({ ok: true });
    expect(await outcome(id)).toMatchObject({ status: "sent", reason: null });
    expect(storefront.resentEmails).toEqual([{ orderId: id, kind: "confirmation", staffName: "Ana" }]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "order.email_resent", description: expect.stringContaining("Ana") }));
    expect((await loadOrder(() => db.sql, id) as { order: { emailFailure: unknown } }).order.emailFailure).toBeNull();
  });

  it("shows the failure reason without an email address", async () => {
    const id = await failedEmail("rejected maria@example.com");
    const result = await loadOrder(() => db.sql, id);
    expect(result.ok && result.order?.emailFailure).toEqual({ reason: "rejected [email removed]" });
  });

  it("refuses when the storefront refuses, keeping the failure and writing no audit", async () => {
    const id = await failedEmail();
    storefront.refusal = "Resend is not available right now.";
    expect(await resendConfirmationEmail(id)).toEqual({ ok: false, reason: "Resend is not available right now." });
    expect((await outcome(id)).status).toBe("failed");
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses an email that is not failed, without calling the storefront", async () => {
    const id = await order("delivery", "confirmed");
    await db.sql`insert into order_email_outcomes (order_id, kind, status) values (${id}, 'confirmation', 'sent')`;
    expect((await resendConfirmationEmail(id)).ok).toBe(false);
    expect(storefront.resentEmails).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses Admin and the CEO", async () => {
    const id = await failedEmail();
    vi.mocked(requireModule).mockResolvedValue({ id: "z", username: "z", name: "Zed", email: "z@example.com", role: "CEO" });
    expect(await resendConfirmationEmail(id)).toEqual({ ok: false, reason: expect.stringContaining("view") });
    expect(storefront.resentEmails).toEqual([]);
  });
});
