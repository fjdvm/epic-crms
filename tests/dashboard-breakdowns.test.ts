import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDashboardFigures } from "@/features/dashboard/figures";
import { resolvePeriod } from "@/features/dashboard/period";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date("2026-10-25T07:00:00Z");
const period = resolvePeriod("today", now);
let clock = Math.floor(Date.now() / 300_000) * 300_000;
let connect: () => TestDatabase["sql"];
const figures = (modules = ["Orders"]) => loadDashboardFigures(connect, { period, modules, now });

beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { vi.restoreAllMocks(); await db.close(); });
beforeEach(async () => {
  vi.restoreAllMocks();
  clock += 600_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await db.sql`truncate order_returns, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values
    ('c1', 'Maria', 'maria@example.com'), ('c2', 'Jose', 'jose@example.com'), ('walk', 'Unverified', 'walk@example.com')`;
  connect = () => db.sql;
});

async function order({ customer = "c1", at = "2026-10-25T02:00:00Z", status = "paid", subtotal = 10000, fee = 0,
  payment = "gcash", receiving = "delivery" } = {}) {
  const [row] = await db.sql<{ id: number }[]>`insert into orders
    (customer_id, created_at, status, subtotal_in_centavos, delivery_fee_in_centavos, payment_method, fulfillment_method)
    values (${customer}, ${new Date(at)}, ${status}, ${subtotal}, ${fee}, ${payment}, ${receiving}) returning id`;
  return row.id;
}

async function line(id: number, name: string, price: number, quantity = 1) {
  const [row] = await db.sql<{ id: number }[]>`insert into order_lines (order_id, product_name, price_in_centavos, quantity)
    values (${id}, ${name}, ${price}, ${quantity}) returning id`;
  return row.id;
}

async function returned(id: number, lineId: number, status: string, amount: number, quantity = 1) {
  const [row] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, status, reason, amount_in_centavos)
    values (${id}, ${status}, 'damaged', ${amount}) returning id`;
  await db.sql`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos)
    select ${row.id}, id, product_name, size_label, ${quantity}, price_in_centavos from order_lines where id = ${lineId}`;
}

describe("Dashboard breakdowns", () => {
  it("ranks four products by net money, combines sizes, and reconciles their shares with Sales", async () => {
    const id = await order({ subtotal: 100000, fee: 5000 });
    const a = await line(id, "A", 10000, 3);
    await line(id, "A", 5000, 2);
    await line(id, "B", 30000);
    const c = await line(id, "C", 10000);
    await line(id, "D", 10000);
    await line(id, "E", 10000);
    await returned(id, a, "refunded", 30000, 3);
    await returned(id, c, "replaced", 10000);
    const unpaid = await order({ status: "placed", subtotal: 900000 });
    await line(unpaid, "Unpaid", 900000);
    const outside = await order({ at: "2026-10-24T15:59:59Z" });
    await line(outside, "Yesterday", 10000);

    const result = await figures();
    expect(result.bestSellers).toEqual({ ok: true, products: [
      { productName: "B", sales: 30000, units: 1, share: 0.4 },
      { productName: "A", sales: 10000, units: 2, share: 10000 / 75000 },
      { productName: "C", sales: 10000, units: 1, share: 10000 / 75000 },
      { productName: "D", sales: 10000, units: 1, share: 10000 / 75000 },
    ], remainder: { sales: 15000, share: 0.2 } });
    expect(result.sales).toMatchObject({ current: 75000 });
  });

  it("returns counts and net money from the stored payment and receiving methods", async () => {
    const a = await order({ subtotal: 20000, fee: 3000 });
    const l = await line(a, "A", 10000, 2);
    await returned(a, l, "refunded", 10000);
    await order({ subtotal: 5000, receiving: "pickup" });
    await order({ subtotal: 7000, payment: "cash-on-delivery", receiving: "pickup", status: "received" });
    await order({ subtotal: 9000, payment: "cash-on-delivery", status: "placed" });

    expect((await figures()).paymentAndReceiving).toEqual({ ok: true,
      payment: [
        { method: "cash-on-delivery", orders: 1, sales: 7000 },
        { method: "gcash", orders: 2, sales: 18000 },
      ],
      receiving: [
        { method: "delivery", orders: 1, sales: 13000 },
        { method: "pickup", orders: 2, sales: 12000 },
      ],
    });
  });

  it("classifies distinct Buyers by their first counted Order in each Philippine month", async () => {
    await order({ at: "2026-05-31T15:59:59Z" }); // May in Manila
    await order({ at: "2026-05-31T16:00:00Z" }); // June, returning
    await order({ customer: "c2", at: "2026-08-01T00:00:00Z", status: "cancelled" });
    await order({ customer: "c2" });
    await order({ customer: "c2" });
    await order();

    expect((await figures()).monthlyBuyers).toEqual({ ok: true, months: [
      { label: "2026-05", soFar: false, new: 1, returning: 0, share: 0 },
      { label: "2026-06", soFar: false, new: 0, returning: 1, share: 1 },
      { label: "2026-07", soFar: false, new: 0, returning: 0, share: null },
      { label: "2026-08", soFar: false, new: 0, returning: 0, share: null },
      { label: "2026-09", soFar: false, new: 0, returning: 0, share: null },
      { label: "2026-10", soFar: true, new: 1, returning: 1, share: 0.5 },
    ] });
  });

  it("returns empty breakdowns for an empty storefront", async () => {
    const result = await figures();
    expect(result.bestSellers).toEqual({ ok: true, products: [], remainder: { sales: 0, share: null } });
    expect(result.paymentAndReceiving).toEqual({ ok: true, payment: [], receiving: [] });
    expect(result.monthlyBuyers).toEqual({ ok: true, months: [] });
  });

  it.each([["Payments"], ["Dashboard"], ["Customer Profiles"], []])("withholds breakdowns for Modules %j", async (...modules) => {
    const result = await figures(modules);
    expect(result).not.toHaveProperty("bestSellers");
    expect(result).not.toHaveProperty("monthlyBuyers");
    expect(result).not.toHaveProperty("paymentAndReceiving");
  });

  it("reuses analytics for five minutes and then reads storefront changes", async () => {
    const a = await order();
    await line(a, "A", 10000);
    const before = await figures();
    const b = await order({ subtotal: 20000 });
    await line(b, "B", 20000);
    clock += 299_999;
    const cached = await figures();
    expect(cached.bestSellers).toEqual(before.bestSellers);
    expect(cached.sales).toEqual(before.sales);
    expect(cached.paymentAndReceiving).toEqual(before.paymentAndReceiving);
    clock += 2;
    const after = await figures();
    expect(after.bestSellers).toMatchObject({ ok: true, products: [
      { productName: "B", sales: 20000 }, { productName: "A", sales: 10000 },
    ] });
    expect(after.sales).toMatchObject({ current: 30000 });
    expect(after.paymentAndReceiving).toMatchObject({ payment: [{ orders: 2, sales: 30000 }] });
  });

  it("a broken product read leaves the other breakdowns available and can be retried", async () => {
    await order();
    await db.sql`alter table order_lines rename to unavailable_lines`;
    try {
      const result = await figures();
      expect(result.bestSellers).toEqual({ ok: false });
      expect(result.paymentAndReceiving).toMatchObject({ ok: true });
      expect(result.monthlyBuyers).toMatchObject({ ok: true });
    } finally {
      await db.sql`alter table unavailable_lines rename to order_lines`;
    }
    expect((await figures()).bestSellers).toMatchObject({ ok: true });
  });


  it("keeps Sales and breakdowns together when Payments Staff warm the cache first", async () => {
    const a = await order();
    await line(a, "A", 10000);
    await figures(["Payments"]);
    clock += 60_000;
    const b = await order({ subtotal: 20000 });
    await line(b, "B", 20000);
    const result = await figures();
    expect(result.sales).toMatchObject({ current: 30000 });
    expect(result.bestSellers).toEqual({ ok: true,
      products: [{ productName: "B", sales: 20000, units: 1, share: 2 / 3 },
        { productName: "A", sales: 10000, units: 1, share: 1 / 3 }],
      remainder: { sales: 0, share: 0 },
    });
    expect(result.paymentAndReceiving).toMatchObject({ payment: [{ orders: 2, sales: 30000 }] });
  });


  it("nested monthly and period reads cannot extend stale Sales beyond five minutes", async () => {
    const a = await order({ at: "2026-09-10T00:00:00Z" });
    await line(a, "A", 10000);
    await figures(); // Warms September through monthly Sales.
    clock += 299_000;
    const b = await order({ at: "2026-09-11T00:00:00Z" });
    await line(b, "B", 10000);
    const lastMonth = () => loadDashboardFigures(connect, {
      period: resolvePeriod("last-month", now), modules: ["Orders"], now,
    });
    expect((await lastMonth()).sales).toMatchObject({ current: 20000 });
    clock += 1001;
    const fresh = await lastMonth();
    expect(fresh.sales).toMatchObject({ current: 20000 });
    expect(fresh.bestSellers).toMatchObject({ remainder: { sales: 0 }, products: [
      { productName: "A", share: 0.5 }, { productName: "B", share: 0.5 },
    ] });
  });


  it("recovered products and Sales use the same generation after storefront changes", async () => {
    const a = await order();
    await line(a, "A", 10000);
    await db.sql`alter table order_lines rename to unavailable_lines`;
    try {
      expect((await figures()).bestSellers).toEqual({ ok: false });
    } finally {
      await db.sql`alter table unavailable_lines rename to order_lines`;
    }
    clock += 60_000;
    const b = await order({ subtotal: 20000 });
    await line(b, "B", 20000);
    const result = await figures();
    expect(result.sales).toMatchObject({ current: 30000 });
    expect(result.bestSellers).toMatchObject({ remainder: { sales: 0 }, products: [
      { productName: "B", sales: 20000 }, { productName: "A", sales: 10000 },
    ] });
  });

  it("Average order uses the count from the same snapshot as Sales", async () => {
    const a = await order({ at: "2026-09-10T00:00:00Z" });
    await line(a, "A", 10000);
    await figures();
    clock += 60_000;
    await order({ at: "2026-09-11T00:00:00Z" });
    const result = await loadDashboardFigures(connect, {
      period: resolvePeriod("last-month", now), modules: ["Orders"], now,
    });
    expect(result.sales).toMatchObject({ current: 20000 });
    expect(result.averageOrder).toMatchObject({ current: 10000 });
  });

});
