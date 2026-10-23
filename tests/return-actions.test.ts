import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { approveReturn, declineReturn, markReturnGoodsReceived, markReturnRefunded, getReturnDetail } from "@/features/returns/actions";
import { requireModule } from "@/lib/portal/staff";
import { database } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

vi.mock("@/lib/portal/staff", () => ({ requireModule: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: vi.fn(() => db.sql) }));
let db: TestDatabase;
let storefront: FakeStorefront;
const now = new Date("2026-10-23T08:00:00Z");
const ana = { username: "ana", name: "Ana Reyes", email: "ana@example.com", role: "Staff" };
beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate order_returns, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
  await db.sql`insert into orders (customer_id, status, delivered_at) values ('c1', 'delivered', '2026-10-20T00:00:00Z')`;
  storefront = new FakeStorefront(db.sql, () => now);
  vi.stubGlobal("fetch", storefrontFetch(storefront));
  vi.stubEnv("CREOMS_STOREFRONT_URL", FAKE_STOREFRONT_URL);
  vi.stubEnv("CREOMS_SERVICE_SECRET", FAKE_SERVICE_SECRET);
  vi.mocked(requireModule).mockResolvedValue(ana);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });
async function requested() {
  const [row] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, reason, amount_in_centavos)
    values (1, 'damaged', 10000) returning id`;
  return row.id;
}

describe("Staff Return decisions", () => {
  it("refuses every out-of-order step and repeat decision without sending a write", async () => {
    const steps = [
      { status: "requested", goods: null, allowed: ["approved", "declined"] },
      { status: "approved", goods: true, allowed: ["goods received"] },
      { status: "approved", goods: false, allowed: ["refunded"] },
      { status: "goods received", goods: true, allowed: ["refunded"] },
      { status: "declined", goods: null, allowed: [] },
      { status: "refunded", goods: false, allowed: [] },
      { status: "cancelled", goods: null, allowed: [] },
    ];
    const actions = {
      approved: (id: number) => approveReturn(id, true),
      declined: (id: number) => declineReturn(id, "Wrong Order"),
      "goods received": markReturnGoodsReceived,
      refunded: markReturnRefunded,
    };
    for (const step of steps) {
      const id = await requested();
      await db.sql`update order_returns set status = ${step.status}, goods_required = ${step.goods} where id = ${id}`;
      for (const [status, act] of Object.entries(actions)) {
        if (!step.allowed.includes(status)) {
          expect(await act(id)).toMatchObject({ ok: false, reason: expect.stringContaining("already changed") });
        }
      }
    }
    expect(storefront.requests).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses missing or invalid Return numbers, bad goods decisions and an unavailable database", async () => {
    const actions = [(id: number) => approveReturn(id, true), (id: number) => declineReturn(id, "Wrong Order"),
      markReturnGoodsReceived, markReturnRefunded];
    for (const act of actions) {
      for (const id of [0, -1, 1.5, NaN, Infinity, "1", null]) {
        expect(await act(id as number)).toEqual({ ok: false, reason: "Invalid Return number." });
      }
      expect(await act(999)).toEqual({ ok: false, reason: "Return was not found." });
    }
    const id = await requested();
    for (const value of [undefined, null, 0, "false"]) {
      // @ts-expect-error Exercise untrusted Server Action arguments.
      expect(await approveReturn(id, value)).toMatchObject({ ok: false, reason: expect.stringContaining("goods") });
    }
    vi.mocked(database).mockImplementationOnce(() => { throw new Error("Database offline"); });
    expect(await approveReturn(id, true)).toEqual({ ok: false, reason: "Return is temporarily unavailable." });
    expect(storefront.requests).toBe(0);
  });

  it("preserves storefront refusal reasons for each decision", async () => {
    const id = await requested();
    storefront.refusal = "The Customer already cancelled this Return.";
    const cases = [
      ["requested", null, () => approveReturn(id, true)],
      ["requested", null, () => declineReturn(id, "Wrong Order")],
      ["approved", true, () => markReturnGoodsReceived(id)],
      ["approved", false, () => markReturnRefunded(id)],
    ] as const;
    for (const [status, goods, act] of cases) {
      await db.sql`update order_returns set status = ${status}, goods_required = ${goods} where id = ${id}`;
      expect(await act()).toEqual({ ok: false, reason: storefront.refusal });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("confirms only one of two competing Staff decisions and preserves the winner's history", async () => {
    const id = await requested();
    vi.mocked(requireModule).mockResolvedValueOnce(ana).mockResolvedValueOnce({ ...ana, username: "ben", name: "Ben Cruz" });
    const results = await Promise.all([approveReturn(id, true), declineReturn(id, "Wrong Order")]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.find(r => !r.ok)).toMatchObject({ reason: expect.stringContaining("already changed") });
    expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { history: [results[0].ok
      ? { status: "approved", actor: { id: "ana", name: "Ana Reyes" } }
      : { status: "declined", actor: { id: "ben", name: "Ben Cruz" } }] } });
  });

  it("does not report or retry a write whose response was lost after committing", async () => {
    const id = await requested();
    const send = storefrontFetch(storefront);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      await send(input, init);
      throw new Error("Response lost");
    });
    expect(await approveReturn(id, false)).toMatchObject({ ok: false, reason: expect.stringContaining("Refresh the Return") });
    expect(storefront.requests).toBe(1);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: { status: "approved", history: [{ status: "approved" }] } });
  });

  it("treats mismatched or malformed confirmations and transport failures as uncertain", async () => {
    const id = await requested();
    const valid = { id, status: "approved", goodsRequired: true, actedBy: { id: "ana", name: "Ana Reyes", at: now.toISOString() } };
    const replies = [null, {}, { ...valid, id: id + 1 }, { ...valid, status: "refunded" },
      { ...valid, goodsRequired: false }, { ...valid, actedBy: null },
      { ...valid, actedBy: { ...valid.actedBy, id: "forged" } },
      { ...valid, actedBy: { ...valid.actedBy, name: "Somebody else" } },
      { ...valid, actedBy: { ...valid.actedBy, at: "invalid" } }];
    for (const reply of replies) {
      const send = vi.fn(async () => Response.json(reply));
      vi.stubGlobal("fetch", send);
      expect(await approveReturn(id, true)).toMatchObject({ ok: false, reason: expect.stringContaining("Refresh the Return") });
      expect(send).toHaveBeenCalledTimes(1);
    }
    for (const response of [new Response("bad JSON"), new Response(null, { status: 204 })]) {
      const send = vi.fn(async () => response);
      vi.stubGlobal("fetch", send);
      expect((await approveReturn(id, true)).ok).toBe(false);
      expect(send).toHaveBeenCalledTimes(1);
    }
    storefront.unavailable = true;
    vi.stubGlobal("fetch", storefrontFetch(storefront));
    expect((await approveReturn(id, true)).ok).toBe(false);
    expect(storefront.requests).toBe(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("requires the existing storefront service configuration", async () => {
    const id = await requested();
    vi.stubEnv("CREOMS_SERVICE_SECRET", "");
    expect(await approveReturn(id, true)).toEqual({ ok: false, reason: "Storefront is not configured." });
    expect(storefront.requests).toBe(0);
  });

  it("records goods received before refunding when goods must come back, with a different Staff member at each step", async () => {
    const id = await requested();
    await approveReturn(id, true);
    expect(await markReturnRefunded(id)).toMatchObject({ ok: false, reason: expect.stringContaining("already changed") });
    vi.mocked(requireModule).mockResolvedValue({ ...ana, username: "ben", name: "Ben Cruz" });
    expect(await markReturnGoodsReceived(id)).toMatchObject({ ok: true, return: { status: "goods received" } });
    vi.mocked(requireModule).mockResolvedValue({ ...ana, username: "carla", name: "Carla Diaz" });
    expect(await markReturnRefunded(id)).toMatchObject({ ok: true, return: { status: "refunded" } });
    expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: {
      status: "refunded", refundedAt: now, orderStatus: "delivered", amount: 10000,
      history: [
        { status: "approved", actor: { id: "ana", name: "Ana Reyes" }, at: now },
        { status: "goods received", actor: { id: "ben", name: "Ben Cruz" }, at: now },
        { status: "refunded", actor: { id: "carla", name: "Carla Diaz" }, at: now },
      ],
    } });
  });

  it("refunds Approved Returns directly when goods are not needed", async () => {
    const id = await requested();
    await approveReturn(id, false);
    expect(await markReturnGoodsReceived(id)).toMatchObject({ ok: false, reason: expect.stringContaining("already changed") });
    expect(await markReturnRefunded(id)).toMatchObject({ ok: true, return: { status: "refunded" } });
    expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: {
      goodsRequired: false, refundedAt: now, history: [{ status: "approved" }, { status: "refunded" }],
    } });
  });

  it("declines only Requested Returns with a reason the Customer can see", async () => {
    const id = await requested();
    for (const reason of ["", "  ", null, 1]) {
      expect(await declineReturn(id, reason as string)).toMatchObject({ ok: false, reason: expect.stringContaining("reason") });
    }
    expect(storefront.requests).toBe(0);
    expect(await declineReturn(id, "  The items do not match this Order.  ")).toMatchObject({ ok: true, return: { id, status: "declined" } });
    expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: {
      declineReason: "The items do not match this Order.",
      history: [{ status: "declined", actor: { type: "staff", id: "ana", name: "Ana Reyes" }, at: now,
        note: "The items do not match this Order." }],
    } });
    const approved = await requested();
    await approveReturn(approved, true);
    expect(await declineReturn(approved, "Changed my mind")).toMatchObject({ ok: false, reason: expect.stringContaining("already changed") });
  });
  it("approves with a goods decision and Portal attribution even after the Refund window", async () => {
    for (const goodsRequired of [true, false]) {
      const id = await requested();
      expect(await approveReturn(id, goodsRequired)).toMatchObject({ ok: true, return: { id, status: "approved" } });
      expect(await getReturnDetail(id)).toMatchObject({ ok: true, detail: {
        status: "approved", goodsRequired,
        history: [{ status: "approved", actor: { type: "staff", id: "ana", name: "Ana Reyes" }, at: now }],
      } });
      expect(revalidatePath).toHaveBeenCalledWith("/(app)/returns", "layout");
    }
    expect(vi.mocked(requireModule).mock.calls.every(([module]) => module === "Returns")).toBe(true);
  });
});
