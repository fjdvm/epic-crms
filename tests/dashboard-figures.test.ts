import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDashboardFigures } from "@/features/dashboard/figures";
import * as attention from "@/features/dashboard/attention";
import { resolvePeriod } from "@/features/dashboard/period";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date("2026-10-25T07:00:00Z");
const today = resolvePeriod("today", now);
const connect = () => db.sql;

beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { vi.restoreAllMocks(); await db.close(); });
let cacheClock = Date.now();
beforeEach(async () => {
  cacheClock += 300_001;
  vi.spyOn(Date, "now").mockImplementation(() => cacheClock);
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
  return loadDashboardFigures(connect, { period, modules, now });
}

const ALL = ["Orders", "Payments"];

it("streams a tile before live attention finishes and reuses its analytics for the PDF", async () => {
  await order("paid", "2026-10-25T02:00:00Z", 123456);
  const queue = Promise.withResolvers<attention.Attention>();
  const live = vi.spyOn(attention, "loadAttention").mockReturnValue(queue.promise);
  try {
    const widgets = await loadDashboardFigures(connect, { period: today, modules: ALL, now, stream: true });
    const sales = await widgets.sales;
    expect(sales).toEqual({ ok: true, current: 123456, previous: 0 });
    // The screen's snapshot must also be used by a PDF requested during the cache window.
    await order("paid", "2026-10-25T03:00:00Z", 50000);
    queue.resolve({});
    expect((await figures(ALL)).sales).toEqual(sales);
  } finally {
    queue.resolve({});
    live.mockRestore();
  }
});

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
      // The cache resolves the database first; the next connection is the Sales widget.
      if (++calls === 2) throw new Error("offline");
      return db.sql;
    };
    await order("paid", "2026-10-25T02:00:00Z");

    const result = await loadDashboardFigures(flaky, { period: today, modules: ALL });

    expect(result.sales).toEqual({ ok: false });
    expect(result.orders).toEqual({ ok: true, current: 1, previous: 0 });
  });
});

describe("Dashboard Average order", () => {
  it("divides Sales by the Orders counted in Sales, not by all Orders", async () => {
    await order("paid", "2026-10-25T02:00:00Z", 100000);
    await order("received", "2026-10-25T03:00:00Z", 50000);
    await order("placed", "2026-10-25T04:00:00Z", 900000);
    await order("cancelled", "2026-10-25T05:00:00Z", 900000);

    expect((await figures(ALL)).averageOrder).toEqual({ ok: true, current: 75000, previous: 0 });
  });

  it("is withheld without the Orders or Payments Module", async () => {
    expect("averageOrder" in (await figures(["Feedback"]))).toBe(false);
  });
});

describe("Dashboard Average rating", () => {
  async function feedback(orderId: number, rating: number, at: string) {
    await db.sql`insert into order_feedback (order_id, rating, comment, created_at) values (${orderId}, ${rating}, '', ${new Date(at)})`;
  }

  it("is the mean stars given in the period, dated by when Feedback was given", async () => {
    const a = await order("received", "2026-10-01T02:00:00Z");
    const b = await order("received", "2026-10-01T02:00:00Z");
    const c = await order("received", "2026-10-01T02:00:00Z");
    await feedback(a, 5, "2026-10-25T02:00:00Z");
    await feedback(b, 4, "2026-10-25T03:00:00Z");
    await feedback(c, 2, "2026-10-24T03:00:00Z");

    expect((await figures([...ALL, "Feedback"])).averageRating).toEqual({
      ok: true,
      current: { average: 4.5, count: 2 },
      previous: { average: 2, count: 1 },
    });
  });

  it("reports no value when there is no Feedback in the period", async () => {
    expect((await figures(["Feedback"])).averageRating).toEqual({
      ok: true,
      current: { average: null, count: 0 },
      previous: { average: null, count: 0 },
    });
  });

  it("is withheld without the Feedback Module", async () => {
    expect("averageRating" in (await figures(ALL))).toBe(false);
  });
});

describe("Dashboard Returning Buyers", () => {
  it("is the share of Buyers who had a counted Order before the period", async () => {
    await order("received", "2026-10-20T02:00:00Z", 1, null, "c1");
    await order("paid", "2026-10-25T02:00:00Z", 1, null, "c1");
    await order("paid", "2026-10-25T03:00:00Z", 1, null, "c2");

    expect((await figures(ALL)).returningBuyers).toMatchObject({ current: { share: 0.5, buyers: 2 } });
  });

  it("counts a Buyer who orders twice once, by their first Order", async () => {
    await order("paid", "2026-10-25T02:00:00Z", 1, null, "c2");
    await order("paid", "2026-10-25T03:00:00Z", 1, null, "c2");

    expect((await figures(ALL)).returningBuyers).toMatchObject({ current: { share: 0, buyers: 1 } });
  });

  it("ignores Orders that do not count in Sales, and Customers with no Orders", async () => {
    await order("cancelled", "2026-10-20T02:00:00Z", 1, null, "c1");
    await order("paid", "2026-10-25T02:00:00Z", 1, null, "c1");
    await db.sql`insert into customers (id, full_name, email) values ('w1', 'Walk In', 'walk@example.com')`;

    expect((await figures(ALL)).returningBuyers).toMatchObject({ current: { share: 0, buyers: 1 } });
  });

  it("has no share when there are no Buyers", async () => {
    expect((await figures(ALL)).returningBuyers).toMatchObject({ current: { share: null, buyers: 0 } });
  });

  it("is withheld without the Orders Module", async () => {
    expect("returningBuyers" in (await figures(["Payments"]))).toBe(false);
  });
});

describe("Dashboard Sales by month", () => {
  it("returns the last six months whatever the period, current month flagged as so far", async () => {
    await order("paid", "2026-10-25T02:00:00Z", 100000);
    await order("paid", "2026-05-31T16:30:00Z", 20000); // 00:30 on 1 June in Manila
    await order("paid", "2026-04-30T15:00:00Z", 99999); // before the window

    const months = (await figures(ALL)).monthlySales;

    expect(months).toMatchObject({ ok: true });
    if (!months?.ok) return;
    expect(months.months.map((m) => [m.label, m.sales, m.soFar])).toEqual([
      ["2026-05", 0, false],
      ["2026-06", 20000, false],
      ["2026-07", 0, false],
      ["2026-08", 0, false],
      ["2026-09", 0, false],
      ["2026-10", 100000, true],
    ]);
  });

  it("is withheld without the Orders or Payments Module", async () => {
    expect("monthlySales" in (await figures(["Feedback"]))).toBe(false);
  });
});
