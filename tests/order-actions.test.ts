import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelOrder, confirmPickup, quoteDeliveryFee } from "@/features/orders/actions";
import { database } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/portal/staff";
import { FakePortal, FAKE_CALLBACK, FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, portalFetch } from "./fake-portal";
import { startTestDatabase, type TestDatabase } from "./ticket-database";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";

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
  storefront = new FakeStorefront(db.sql);
  vi.stubGlobal("fetch", storefrontFetch(storefront));
  vi.stubEnv("CREOMS_STOREFRONT_URL", FAKE_STOREFRONT_URL);
  vi.stubEnv("CREOMS_SERVICE_SECRET", FAKE_SERVICE_SECRET);
  vi.mocked(requireModule).mockResolvedValue({ username: "ana", name: "Ana", email: "ana@example.com", role: "Staff" });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function order(method = "delivery", status = "placed") {
  const [row] = await db.sql`insert into orders (customer_id, fulfillment_method, status)
    values ('c1', ${method}, ${status}) returning id`;
  return row.id as number;
}
describe("Order actions", () => {
  it("refuses direct calls when the Portal grants Payments and Fulfilment but no Orders Module", async () => {
    const portal = new FakePortal();
    portal.addStaff("ben", { username: "ben", name: "Ben", email: "ben@example.com", role: "Staff" }, ["Payments", "Fulfilment"]);
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
    vi.stubGlobal("fetch", portalFetch(portal));
    const actual = await vi.importActual<typeof import("@/lib/portal/staff")>("@/lib/portal/staff");
    vi.mocked(requireModule).mockImplementation(actual.requireModule);
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
