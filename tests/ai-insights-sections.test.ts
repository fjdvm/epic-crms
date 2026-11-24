import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { customerInsightsIn } from "@/features/ai-insights/customers";
import { operationsInsightsIn, stockCoverAt } from "@/features/ai-insights/operations";
import { orderInsightsIn } from "@/features/ai-insights/orders";
import { paymentInsightsIn } from "@/features/ai-insights/payments";
import { resolvePeriod } from "@/features/dashboard/period";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
// Wednesday 25 Nov 2026, 4pm in Manila. "7 days" is 19–25 Nov (Manila); the period before is 12–18 Nov.
const now = new Date("2026-11-25T08:00:00Z");
const period = resolvePeriod("7-days", now);
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql`create table crms.stock_count (ims_product_id integer primary key, name text not null, variant text, active boolean not null default true, available integer)`;
  await db.sql`create table products (slug text primary key, name text not null)`;
  await db.sql`create table sizes (id integer primary key generated always as identity, product_slug text not null, label text not null, ims_product_id integer)`;
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate failed_deliveries, order_cancellations, order_payment_proofs, order_feedback, tickets, order_returns, orders, customers, neon_auth."user", products, sizes, crms.stock_count restart identity cascade`;
  await db.sql`insert into neon_auth."user" (id, "emailVerified", "createdAt") values ('c1', true, ${at("2026-01-01T00:00:00Z")}), ('c2', true, ${at("2026-01-01T00:00:00Z")}), ('c3', true, ${at("2026-01-01T00:00:00Z")}), ('lead', false, ${now})`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria', 'm@example.com'), ('c2', 'Jose', 'j@example.com'), ('c3', 'Ana', 'a@example.com'), ('lead', 'Lead', 'l@example.com')`;
});

async function order(f: { customer?: string; created?: string; status?: string; payment?: string; subtotal?: number; fee?: number;
  paid?: string; collected?: string; delivered?: string; courier?: string; threshold?: number; senior?: boolean; method?: string } = {}) {
  const [row] = await db.sql<{ id: number }[]>`insert into orders (customer_id, created_at, status, payment_method, subtotal_in_centavos,
      delivery_fee_in_centavos, paid_at, collected_at, delivered_at, courier, free_delivery_threshold_in_centavos, fulfillment_method)
    values (${f.customer ?? "c1"}, ${at(f.created ?? "2026-11-23T02:00:00Z")}, ${f.status ?? "paid"}, ${f.payment ?? "gcash"}, ${f.subtotal ?? 10000},
      ${f.fee ?? 0}, ${f.paid ? at(f.paid) : null}, ${f.collected ? at(f.collected) : null}, ${f.delivered ? at(f.delivered) : null},
      ${f.courier ?? null}, ${f.threshold ?? null}, ${f.method ?? "delivery"}) returning id`;
  return row.id;
}
const line = (id: number, name: string, quantity = 1, size = "") =>
  db.sql`insert into order_lines (order_id, product_name, size_label, price_in_centavos, quantity) values (${id}, ${name}, ${size}, 10000, ${quantity}) returning id`;

describe("orderInsightsIn", () => {
  it("follows Orders from placed to delivered, by status when there is no time, with reasons, peak hours and pairs", async () => {
    const a = await order({ created: "2026-11-23T02:00:00Z", paid: "2026-11-23T04:00:00Z", status: "delivered", delivered: "2026-11-24T02:00:00Z" });
    await order({ created: "2026-11-23T02:30:00Z", status: "dispatched", payment: "cash-on-delivery" });
    await order({ created: "2026-11-23T03:00:00Z", status: "placed" });
    const cancelled = await order({ created: "2026-11-23T03:10:00Z", status: "cancelled" });
    await order({ created: "2026-11-24T03:00:00Z", status: "received", method: "pickup", collected: "2026-11-24T05:00:00Z", paid: "2026-11-24T04:00:00Z" });
    await db.sql`insert into order_cancellations (id, order_id, reason, actor_type, actor_id, actor_name)
      values ('00000000-0000-0000-0000-000000000001', ${cancelled}, 'Changed mind', 'customer', 'c1', 'Maria')`;
    await db.sql`insert into failed_deliveries (id, order_id, reason, next_step, customer_message, staff_id, staff_name, created_at)
      values ('f1', ${a}, 'Not home', 'rebook', 'Sorry', 's1', 'Ana', ${at("2026-11-23T09:00:00Z")})`;
    for (const id of [a, cancelled]) { await line(id, "Ube Jam"); await line(id, "Halaya"); }
    await order({ created: "2026-11-10T02:00:00Z" }); // outside

    const o = await orderInsightsIn(db.sql, period);
    expect(o.funnel).toEqual([
      { key: "placed", count: 5, medianHours: null },
      { key: "paid", count: 3, medianHours: 1.5 },
      { key: "handedOver", count: 3, medianHours: 1 },
      { key: "delivered", count: 2, medianHours: null },
    ]);
    expect(o.cancelled).toBe(1);
    expect([o.peak[1][10], o.peak[1][11]]).toEqual([2, 2]); // Monday 10am and 11am Manila
    expect(o.peak[2][11]).toBe(1);
    expect(o.cancelReasons).toEqual([{ label: "Changed mind", count: 1 }]);
    expect(o.failedReasons).toEqual([{ label: "Not home", count: 1 }]);
    expect(o.pairs).toEqual([{ a: "Halaya", b: "Ube Jam", orders: 1, ordersOfLessPopular: 1 }]); // the cancelled Order is left out
  });
});

describe("paymentInsightsIn", () => {
  it("compares methods with the period before, times proof checks, ages unpaid Orders and finds near-free-delivery Orders", async () => {
    const weekday = await order({ created: "2026-11-23T01:00:00Z", paid: "2026-11-23T03:00:00Z" });
    const weekend = await order({ created: "2026-11-21T01:00:00Z", paid: "2026-11-21T09:00:00Z", fee: 5000, subtotal: 90000, threshold: 100000 });
    await order({ created: "2026-11-15T01:00:00Z" });
    await order({ payment: "cash-on-delivery", status: "delivered", fee: 5000, subtotal: 50000, threshold: 100000 });
    await db.sql`insert into order_payment_proofs (order_id, reference, submitted_at, rejected_at) values
      (${weekday}, 'REF1', ${at("2026-11-23T01:00:00Z")}, null),
      (${weekend}, 'REF1', ${at("2026-11-21T01:00:00Z")}, ${at("2026-11-21T02:00:00Z")}),
      (${weekend}, 'REF2', ${at("2026-11-21T03:00:00Z")}, null)`;
    await order({ status: "placed", created: "2026-11-25T06:00:00Z", subtotal: 1000 });
    await order({ status: "confirmed", created: "2026-11-20T06:00:00Z", subtotal: 2000 });
    await order({ status: "placed", payment: "cash-on-delivery", created: "2026-11-01T06:00:00Z" });
    const returned = await order({ status: "delivered" });
    await db.sql`insert into order_returns (order_id, status, reason, amount_in_centavos, refunded_at) values (${returned}, 'refunded', 'damaged', 3000, ${at("2026-11-24T00:00:00Z")})`;

    const p = await paymentInsightsIn(db.sql, period, now);
    expect(p.methods).toEqual([
      { method: "gcash", orders: 3, sales: 115000, previousOrders: 1 },
      { method: "cash-on-delivery", orders: 1, sales: 55000, previousOrders: 0 },
    ]);
    expect(p.verify).toEqual({ orders: 2, medianHours: 5, slowestHours: 8, weekdayMedianHours: 2, weekendMedianHours: 8 });
    expect(p.proofs).toEqual({ submitted: 3, rejected: 1, reusedReference: 2 });
    expect(p.unpaid).toEqual([
      { key: "under-1-day", orders: 1, value: 1000 }, { key: "1-to-3-days", orders: 0, value: 0 }, { key: "over-3-days", orders: 1, value: 2000 },
    ]);
    expect(p.refunds).toEqual({ count: 1, amount: 3000, reasons: [{ label: "damaged", count: 1 }] });
    expect(p.nearFreeDelivery).toEqual({ orders: 1, eligible: 2 });
  });
});

describe("customerInsightsIn", () => {
  it("counts stages, loyal Customers gone quiet, repeat rate, spend and the top Customers, leaving out leads", async () => {
    for (const d of ["2026-05-01", "2026-06-01", "2026-07-01"]) await order({ customer: "c1", created: `${d}T02:00:00Z`, subtotal: 100000 });
    await order({ customer: "c2", created: "2026-11-01T02:00:00Z" });
    await order({ customer: "c2", created: "2026-11-23T02:00:00Z" });
    await order({ customer: "lead" });
    await db.sql`update orders set senior_pwd_verification_id = null`;

    const c = await customerInsightsIn(db.sql, period, now);
    expect(c.stages).toEqual({ new: 1, "first-order": 0, repeat: 1, "at-risk": 0, lost: 1 });
    expect(c.loyalAtRisk).toBe(1);
    expect(c.repeatRate).toBe(1);
    expect(c.buyersInPeriod).toBe(1);
    expect(c.returningBuyersInPeriod).toBe(1);
    expect(c.seniorPwdShare).toBe(0);
    expect(c.valueBuckets.map((b) => b.customers)).toEqual([1, 0, 0, 1, 0]);
    expect(c.top.map((t) => [t.name, t.orders, t.spent])).toEqual([["Maria", 3, 300000], ["Jose", 2, 20000]]);
  });
});

describe("operationsInsightsIn", () => {
  it("counts couriers, returns by product, inspected value, Tickets and Feedback", async () => {
    const sent = await order({ status: "delivered", courier: "Lalamove" });
    await order({ status: "dispatched", courier: "Lalamove" });
    await order({ status: "paid", courier: "Grab" }); // not out yet
    await db.sql`insert into failed_deliveries (id, order_id, reason, next_step, customer_message, staff_id, staff_name) values ('f1', ${sent}, 'Not home', 'rebook', 'Sorry', 's', 'Ana')`;
    const [{ id: lineId }] = await line(sent, "Ube Jam", 4);
    const [r] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, status, reason, amount_in_centavos, requested_at)
      values (${sent}, 'approved', 'damaged', 10000, ${at("2026-11-24T00:00:00Z")}) returning id`;
    await db.sql`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos, condition, inspected_at)
      values (${r.id}, ${lineId}, 'Ube Jam', '', 2, 10000, 'damaged', ${at("2026-11-24T01:00:00Z")})`;
    await db.sql`insert into tickets (customer_id, subject, category, created_at, resolved_at, rating, rated_at) values
      ('c1', 'Late', 'Delivery', ${at("2026-11-23T00:00:00Z")}, ${at("2026-11-23T04:00:00Z")}, 4, ${at("2026-11-23T05:00:00Z")})`;
    for (const id of [sent, await order(), await order()]) {
      if (id !== sent) await line(id, "Ube Jam");
      await db.sql`insert into order_feedback (order_id, rating, comment, sentiment, created_at) values (${id}, 2, 'meh', 'negative', ${at("2026-11-24T00:00:00Z")})`;
    }

    const o = await operationsInsightsIn(db.sql, period);
    expect(o.fulfilment.couriers).toEqual([{ courier: "Lalamove", dispatched: 2, failed: 1 }]);
    expect(o.returns).toEqual({ requested: 1, reasons: [{ label: "damaged", count: 1 }], products: [{ product: "Ube Jam", sold: 6, returned: 2 }], restockedValue: 0, writtenOffValue: 20000 });
    expect(o.tickets).toEqual({ opened: 1, resolved: 1, medianResolveHours: 4, categories: [{ label: "Delivery", count: 1 }], averageRating: 4 });
    expect(o.feedback).toEqual({ ratings: 3, average: 2, negativeShare: 1, lowestProducts: [{ product: "Ube Jam", ratings: 3, average: 2 }] });
  });
});

describe("stockCoverAt", () => {
  it("lists IMS Sizes that will run out within 5 days at the last two weeks' sales, soonest first", async () => {
    await db.sql`insert into products (slug, name) values ('jam', 'Ube Jam'), ('halaya', 'Halaya')`;
    await db.sql`insert into sizes (product_slug, label, ims_product_id) values ('jam', '250g', 11), ('halaya', '500g', 12)`;
    await db.sql`insert into crms.stock_count (ims_product_id, name, variant, available) values (11, 'Ube Jam', '250g', 6), (12, 'Halaya', '500g', 500)`;
    await line(await order({ created: "2026-11-20T00:00:00Z" }), "Ube Jam", 28, "250g");
    await line(await order({ created: "2026-11-20T00:00:00Z" }), "Halaya", 14, "500g");
    await line(await order({ created: "2026-10-01T00:00:00Z" }), "Halaya", 900, "500g"); // too old

    expect(await stockCoverAt(db.sql, db.sql, now)).toEqual([{ name: "Ube Jam (250g)", available: 6, soldPerDay: 2, daysLeft: 3 }]);
  });
});
