import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { expiringFactsAt, orderFactsIn, periodSpan, returnFactsIn, slaFactsAt, stockFactsAt, themeFactsIn } from "@/features/ai-insights/facts";
import { DEFAULT_HISTORY } from "@/features/tickets/service-level";
import * as structured from "@/lib/ai/structured";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
// Wednesday 25 Nov 2026, 6:00 am in Manila. "7 days" is 18–24 Nov (Manila); the period before is 11–17 Nov.
const now = new Date("2026-11-24T22:00:00Z");
const span = periodSpan(7, now);
const at = (iso: string) => new Date(iso);
const HOUR = 3_600_000;

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`alter table orders add column confirmed_at timestamptz, add column payment_deadline_at timestamptz`;
  await db.sql`create schema crms`;
  await db.sql`create table crms.stock_count (ims_product_id integer primary key, name text not null, variant text, active boolean not null default true, available integer)`;
  await db.sql`create table products (slug text primary key, name text not null)`;
  await db.sql`create table sizes (id integer primary key generated always as identity, product_slug text not null, label text not null, ims_product_id integer)`;
  await db.sql.unsafe(readFileSync("docs/db/crms-complaint-themes.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  vi.restoreAllMocks();
  await db.sql`truncate failed_deliveries, order_returns, ticket_messages, tickets, orders, customers, products, sizes, crms.stock_count, crms.complaint_themes restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
});

async function order(f: { created?: string; status?: string; payment?: string; paid?: string | null; delivered?: string; courier?: string;
  province?: string; city?: string; free?: boolean; method?: string; dispatched?: string; confirmed?: string; deadline?: string;
  proof?: string; rejected?: string; subtotal?: number } = {}) {
  const [row] = await db.sql<{ id: number }[]>`insert into orders (customer_id, created_at, status, payment_method, subtotal_in_centavos, paid_at,
      delivered_at, courier, free_delivery, fulfillment_method, dispatched_at, confirmed_at, payment_deadline_at, payment_proof_submitted_at, payment_proof_rejected_at)
    values ('c1', ${at(f.created ?? "2026-11-22T02:00:00Z")}, ${f.status ?? "delivered"}, ${f.payment ?? "gcash"}, ${f.subtotal ?? 10000},
      ${f.paid === null ? null : at(f.paid ?? f.created ?? "2026-11-22T02:00:00Z")}, ${f.delivered ? at(f.delivered) : null}, ${f.courier ?? null},
      ${f.free ?? false}, ${f.method ?? "delivery"}, ${f.dispatched ? at(f.dispatched) : null}, ${f.confirmed ? at(f.confirmed) : null},
      ${f.deadline ? at(f.deadline) : null}, ${f.proof ? at(f.proof) : null}, ${f.rejected ? at(f.rejected) : null}) returning id`;
  if (f.method !== "pickup") {
    await db.sql`insert into order_delivery_addresses (order_id, street, barangay, city, province, postal_code)
      values (${row.id}, '1 Street', 'San Antonio', ${f.city ?? "City of Pasig"}, ${f.province ?? ""}, '1600')`;
  }
  return row.id;
}

describe("orderFactsIn", () => {
  it("counts Orders, late or failed deliveries, returns, complaints and free delivery by city and courier, now and before", async () => {
    // On time: delivered a day after payment.
    await order({ created: "2026-11-22T02:00:00Z", delivered: "2026-11-23T02:00:00Z", courier: "Lalamove", free: true });
    // Late: delivered three days after payment.
    const late = await order({ created: "2026-11-19T02:00:00Z", delivered: "2026-11-22T03:00:00Z", courier: "Lalamove" });
    // Failed.
    const failed = await order({ created: "2026-11-23T02:00:00Z", status: "dispatched", courier: "Grab", city: "Taytay", province: "Rizal" });
    await db.sql`insert into failed_deliveries (id, order_id, reason, next_step, customer_message, staff_id, staff_name)
      values ('f1', ${failed}, 'No one home', 'rebook', 'We will try again', 's1', 'Ana')`;
    // With a Return and a Ticket.
    const returned = await order({ created: "2026-11-21T02:00:00Z", delivered: "2026-11-21T10:00:00Z", courier: "Lalamove", city: "Quezon City" });
    await db.sql`insert into order_returns (order_id, reason, amount_in_centavos) values (${returned}, 'damaged', 10000)`;
    await db.sql`insert into tickets (customer_id, subject, order_id) values ('c1', 'Leaking lid', ${returned})`;
    // Pickup, the period before, unpaid and cancelled.
    await order({ created: "2026-11-22T02:00:00Z", status: "received", method: "pickup" });
    await order({ created: "2026-11-12T02:00:00Z", delivered: "2026-11-16T02:00:00Z", courier: "Lalamove" });
    await order({ created: "2026-11-22T02:00:00Z", status: "placed", paid: null });
    await order({ created: "2026-11-22T02:00:00Z", status: "cancelled" });

    const facts = await orderFactsIn(db.sql, span, now);
    expect(facts).toMatchObject({ orders: 5, previousOrders: 1, wentOut: 4, lateOrFailed: 2, returnedOrders: 1, unmapped: 0 });
    const mm = facts.areas.find((a) => a.key === "metro manila")!;
    expect(mm).toMatchObject({ orders: 3, previousOrders: 1, wentOut: 3, lateOrFailed: 1, previousWentOut: 1, previousLateOrFailed: 1, returned: 1, complaints: 1, deliveries: 3, freeDelivery: 1 });
    expect(mm.cities.map((c) => [c.key, c.name, c.orders])).toEqual([["metro manila|pasig", "Pasig", 2], ["metro manila|quezon", "Quezon City", 1]]);
    expect(facts.areas.find((a) => a.key === "rizal")!.cities[0]).toMatchObject({ key: "rizal|taytay", name: "Taytay", lateOrFailed: 1 });
    expect(facts.couriers).toEqual([
      { courier: "Lalamove", wentOut: 3, lateOrFailed: 1, previousWentOut: 1, previousLateOrFailed: 1, orderIds: [late] },
      { courier: "Grab", wentOut: 1, lateOrFailed: 1, previousWentOut: 0, previousLateOrFailed: 0, orderIds: [failed] },
    ]);
    expect(facts.lateOrFailedByCity).toEqual(expect.arrayContaining([{ key: "metro manila|pasig", orderIds: [late] }, { key: "rizal|taytay", orderIds: [failed] }]));
  });
});

describe("expiringFactsAt", () => {
  it("uses the storefront's expiry rule: the saved deadline, confirmed or awaiting payment, and a proof waiting pauses it", async () => {
    const soon = await order({ status: "confirmed", paid: null, deadline: "2026-11-25T10:00:00Z", subtotal: 50000 });
    const legacy = await order({ status: "confirmed", paid: null, confirmed: "2026-11-24T12:00:00Z" }); // + 24h = 25 Nov 12:00 UTC
    const rejected = await order({ status: "awaiting payment", paid: null, deadline: "2026-11-25T01:00:00Z", proof: "2026-11-24T00:00:00Z", rejected: "2026-11-24T01:00:00Z" });
    await order({ status: "awaiting payment", paid: null, deadline: "2026-11-25T01:00:00Z", proof: "2026-11-24T00:00:00Z" }); // waiting to be checked
    await order({ status: "confirmed", paid: null, deadline: "2026-11-27T01:00:00Z" }); // later than 24 hours
    await order({ status: "confirmed", paid: null, deadline: "2026-11-24T20:00:00Z" }); // already past
    await order({ status: "confirmed", paid: null, payment: "cash-on-delivery", deadline: "2026-11-25T01:00:00Z" });
    await order({ status: "placed", paid: null }); // not confirmed yet: no deadline

    const facts = await expiringFactsAt(db.sql, now);
    expect(facts).toEqual({ orders: 3, value: 70000, orderIds: [rejected, soon, legacy], soonestHours: 3 });
  });
});

describe("slaFactsAt", () => {
  const ticket = async (created: Date, f: { status?: string; held?: number; holdStarted?: Date; staffReply?: boolean } = {}) => {
    const [row] = await db.sql<{ id: number }[]>`insert into tickets (customer_id, subject, created_at, status, held_seconds, hold_started_at)
      values ('c1', 'Help', ${created}, 'open', ${f.held ?? 0}, null) returning id`;
    if (f.status === "on_hold") await db.sql`update tickets set status = 'on_hold' where id = ${row.id}`;
    if (f.holdStarted) await db.sql`update tickets set hold_started_at = ${f.holdStarted} where id = ${row.id}`;
    await db.sql`insert into ticket_messages (ticket_id, sender, body, created_at) values (${row.id}, 'customer', 'Hello', ${created})`;
    if (f.staffReply) await db.sql`insert into ticket_messages (ticket_id, sender, body, created_at) values (${row.id}, 'staff', 'Hi', ${new Date(created.getTime() + HOUR)})`;
    return row.id;
  };

  it("keeps open Tickets with 75% or more of the first-reply target used, and stops the clock while On hold", async () => {
    const breaching = await ticket(new Date(now.getTime() - 23.5 * HOUR));
    const atRisk = await ticket(new Date(now.getTime() - 19 * HOUR));
    await ticket(new Date(now.getTime() - 10 * HOUR)); // early
    await ticket(new Date(now.getTime() - 20 * HOUR), { held: 6 * 3600 }); // 14 hours worked
    await ticket(new Date(now.getTime() - 22 * HOUR), { status: "on_hold" }); // paused
    await ticket(new Date(now.getTime() - 22 * HOUR), { staffReply: true }); // answered
    await ticket(new Date(now.getTime() - 30 * HOUR)); // already missed

    const facts = await slaFactsAt(db.sql, DEFAULT_HISTORY, now);
    expect(facts).toEqual({ atRisk: 2, breaching: 1, ticketIds: [breaching, atRisk], open: 7 });
  });
});

describe("returnFactsIn and stockFactsAt", () => {
  it("counts units sold and returned per product, leaving out declined Returns", async () => {
    const a = await order();
    const [l1] = await db.sql<{ id: number }[]>`insert into order_lines (order_id, product_name, quantity) values (${a}, 'Ube jam', 10) returning id`;
    const [l2] = await db.sql<{ id: number }[]>`insert into order_lines (order_id, product_name, quantity) values (${a}, 'Halaya', 4) returning id`;
    const [r1] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, reason, amount_in_centavos, requested_at) values (${a}, 'damaged', 1, ${at("2026-11-23T00:00:00Z")}) returning id`;
    const [r2] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, reason, amount_in_centavos, requested_at, status) values (${a}, 'other', 1, ${at("2026-11-23T00:00:00Z")}, 'declined') returning id`;
    await db.sql`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos) values
      (${r1.id}, ${l2.id}, 'Halaya', '', 2, 1), (${r2.id}, ${l1.id}, 'Ube jam', '', 5, 1)`;

    const facts = await returnFactsIn(db.sql, span);
    expect(facts).toEqual({ requested: 2, returns: { sold: 14, returned: 2, products: [{ product: "Halaya", sold: 4, returned: 2, returnIds: [r1.id] }] } });
  });

  it("finds Sizes that run out within 5 days at the last 14 days' sales, with the Orders that sold them", async () => {
    await db.sql`insert into products (slug, name) values ('ube', 'Ube halaya')`;
    await db.sql`insert into sizes (product_slug, label, ims_product_id) values ('ube', '12 oz', 12), ('ube', '6 oz', 6)`;
    await db.sql`insert into crms.stock_count (ims_product_id, name, variant, available) values (12, 'Ube halaya', '12 oz', 8), (6, 'Ube halaya', '6 oz', 500)`;
    const a = await order({ created: "2026-11-20T00:00:00Z" }), b = await order({ created: "2026-11-23T00:00:00Z" });
    await db.sql`insert into order_lines (order_id, product_name, size_label, quantity) values (${a}, 'Ube halaya', '12 oz', 14), (${b}, 'Ube halaya', '12 oz', 14), (${b}, 'Ube halaya', '6 oz', 1)`;

    expect(await stockFactsAt({ source: db.sql, crms: db.sql }, now)).toEqual([
      { key: "12", name: "Ube halaya 12 oz", available: 8, soldPerDay: 2, daysLeft: 4, unitsSold: 28, orderIds: [b, a] },
    ]);
  });
});

describe("themeFactsIn", () => {
  it("keeps Ticket themes only, and finds the product and city most of their Orders share", async () => {
    const ids: number[] = [];
    for (const city of ["City of Pasig", "City of Pasig", "Quezon City"]) {
      const o = await order({ city });
      await db.sql`insert into order_lines (order_id, product_name) values (${o}, 'Ube halaya')`;
      const [t] = await db.sql<{ id: number }[]>`insert into tickets (customer_id, subject, order_id, created_at) values ('c1', 'Lid', ${o}, ${at("2026-11-22T00:00:00Z")}) returning id`;
      await db.sql`insert into ticket_messages (ticket_id, sender, body, created_at) values (${t.id}, 'customer', 'The lid leaks', ${at("2026-11-22T00:00:00Z")})`;
      ids.push(t.id);
    }
    // One Customer counts once per theme, so each Ticket needs its own Customer.
    await db.sql`insert into customers (id, full_name, email) values ('c2', 'Jose', 'j@example.com'), ('c3', 'Ana', 'a@example.com')`;
    await db.sql`update tickets set customer_id = 'c2' where id = ${ids[1]}`;
    await db.sql`update tickets set customer_id = 'c3' where id = ${ids[2]}`;
    const spy = vi.spyOn(structured, "structuredOutput").mockResolvedValue({ ok: true, model: "m", output: { themes: [{ label: "Leaking lids", ids: ids.map((id) => `T${id}`) }] } });

    const themes = await themeFactsIn({ source: db.sql, crms: db.sql }, span);
    expect(themes).toEqual([{ label: "Leaking lids", ticketIds: [...ids].reverse(), product: "Ube halaya", productTickets: 3, area: "Pasig", areaTickets: 2 }]);
    expect(String(spy.mock.calls[0][0].prompt)).not.toMatch(/Maria|maria@example/);
  });
});
