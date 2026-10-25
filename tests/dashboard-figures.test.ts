import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadDashboardFigures } from "@/features/dashboard/figures";
import { resolvePeriod } from "@/features/dashboard/period";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date("2026-10-25T07:00:00Z");
const today = resolvePeriod("today", now);
const connect = () => db.sql;

beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate order_returns, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com'),
    ('c2', 'Jose Reyes', 'jose@example.com')`;
});

async function order(status: string, at: string, subtotal = 100000, fee: number | null = null, customer = "c1") {
  const [row] = await db.sql<{ id: number }[]>`insert into orders
    (customer_id, status, subtotal_in_centavos, delivery_fee_in_centavos, created_at)
    values (${customer}, ${status}, ${subtotal}, ${fee}, ${new Date(at)}) returning id`;
  return row.id;
}

async function figures(modules: string[], period = today) {
  return loadDashboardFigures(connect, { period, modules });
}

const ALL = ["Orders", "Payments"];

describe("Dashboard Sales", () => {
  it("sums paid and fulfilled Order totals, delivery fee included", async () => {
    await order("paid", "2026-10-25T02:00:00Z", 100000, 15000);
    await order("received", "2026-10-25T03:00:00Z", 50000);

    expect((await figures(ALL)).sales).toEqual({ ok: true, current: 165000, previous: 0 });
  });

  it.each(["placed", "confirmed", "awaiting payment", "cancelled"])("leaves out %s Orders", async (status) => {
    await order(status, "2026-10-25T02:00:00Z");

    expect((await figures(ALL)).sales).toMatchObject({ current: 0 });
  });

  it("dates an Order by when it was placed, in Philippine Time", async () => {
    // 23:30 on the 24th in Manila is 15:30Z: yesterday. 00:30 on the 25th is 16:30Z the 24th.
    await order("paid", "2026-10-24T15:30:00Z", 10000);
    await order("paid", "2026-10-24T16:30:00Z", 20000);
    await order("paid", "2026-10-25T15:59:59Z", 40000);
    await order("paid", "2026-10-25T16:00:00Z", 80000);

    expect((await figures(ALL)).sales).toEqual({ ok: true, current: 60000, previous: 10000 });
  });

  it("subtracts Refunded Return amounts, and only those", async () => {
    const id = await order("received", "2026-10-25T02:00:00Z", 100000);
    const other = await order("received", "2026-10-25T02:00:00Z", 100000);
    await db.sql`insert into order_returns (order_id, status, reason, amount_in_centavos) values
      (${id}, 'refunded', 'damaged', 30000), (${other}, 'replaced', 'damaged', 100000)`;
    await db.sql`insert into order_returns (order_id, status, reason, amount_in_centavos) values
      (${other}, 'requested', 'damaged', 50000)`;

    expect((await figures(ALL)).sales).toMatchObject({ current: 170000 });
  });

  it("is withheld without the Orders or Payments Module, and given with either", async () => {
    await order("paid", "2026-10-25T02:00:00Z");

    expect("sales" in (await figures(["Fulfilment", "Returns"]))).toBe(false);
    expect((await figures(["Orders"])).sales).toMatchObject({ current: 100000 });
    expect((await figures(["Payments"])).sales).toMatchObject({ current: 100000 });
  });
});

describe("Dashboard Orders", () => {
  it("counts non-cancelled Orders placed in the period and the one before", async () => {
    await order("placed", "2026-10-25T02:00:00Z");
    await order("received", "2026-10-25T03:00:00Z", 1, null, "c2");
    await order("cancelled", "2026-10-25T04:00:00Z");
    await order("paid", "2026-10-24T04:00:00Z");

    expect((await figures(ALL)).orders).toEqual({ ok: true, current: 2, previous: 1 });
  });

  it("is withheld without the Orders Module", async () => {
    expect("orders" in (await figures(["Payments"]))).toBe(false);
  });
});

describe("a failing widget", () => {
  it("does not fail the others", async () => {
    let calls = 0;
    const flaky = () => {
      if (++calls === 1) throw new Error("offline");
      return db.sql;
    };
    await order("paid", "2026-10-25T02:00:00Z");

    const result = await loadDashboardFigures(flaky, { period: today, modules: ALL });

    expect(result.sales).toEqual({ ok: false });
    expect(result.orders).toEqual({ ok: true, current: 1, previous: 0 });
  });
});
