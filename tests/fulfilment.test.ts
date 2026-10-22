import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadFulfilmentBoard } from "@/features/orders/fulfilment";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date("2026-10-23T04:00:00Z");

beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate order_delivery_addresses, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
});

async function order(status: string, payment = "cash-on-delivery", fulfillment = "delivery") {
  const [row] = await db.sql<{ id: number }[]>`
    insert into orders (customer_id, status, payment_method, fulfillment_method)
    values ('c1', ${status}, ${payment}, ${fulfillment}) returning id`;
  return row.id;
}

async function board() {
  const result = await loadFulfilmentBoard(() => db.sql, { now });
  if (!result.ok) throw new Error("Expected the Fulfilment board to load");
  return result.board;
}

describe("Fulfilment board data", () => {
  it("returns all four empty columns when no Orders need Fulfilment", async () => {
    expect(await board()).toEqual({ ready: [], preparing: [], dispatched: [], delivered: [] });
  });

  it("reports an unavailable database instead of pretending the board is empty", async () => {
    expect(await loadFulfilmentBoard(() => { throw new Error("offline"); }, { now })).toEqual({ ok: false });
  });
  it("returns the Customer, items, total and dates needed for an Order card", async () => {
    const id = await order("confirmed");
    const createdAt = new Date("2026-10-01T04:00:00Z");
    await db.sql`update orders set subtotal_in_centavos = 100000, delivery_fee_in_centavos = 15000,
      created_at = ${createdAt} where id = ${id}`;
    await db.sql`insert into order_lines (order_id, product_name, quantity) values (${id}, 'Halaya', 2)`;
    expect((await board()).ready).toEqual([{
      id, customerId: "c1", customerName: "Maria Santos", createdAt, deliveredAt: null,
      status: "confirmed", fulfillmentMethod: "delivery", paymentMethod: "cash-on-delivery",
      paymentLabel: "Unpaid", total: 115000, lines: [{ product: "Halaya", quantity: 2 }],
    }]);
  });
  it("groups preparing, dispatched and recently delivered Orders by their actual stage", async () => {
    const preparing = await order("preparing");
    const dispatched = await order("dispatched");
    const delivered = await order("delivered");
    const old = await order("delivered");
    const boundary = await order("delivered");
    const future = await order("delivered");
    await db.sql`update orders set delivered_at = ${new Date("2026-10-24T04:00:00Z")} where id = ${future}`;
    await order("delivered"); // Legacy Order with no recorded Delivery time.
    await db.sql`update orders set delivered_at = ${new Date("2026-10-22T04:00:00Z")} where id = ${delivered}`;
    await db.sql`update orders set delivered_at = ${new Date("2026-10-16T03:59:59.999Z")} where id = ${old}`;
    await db.sql`update orders set delivered_at = ${new Date("2026-10-16T04:00:00Z")},
      created_at = ${new Date("2026-01-01T00:00:00Z")} where id = ${boundary}`;

    const result = await board();
    expect(result.ready).toEqual([]);
    expect(result.preparing.map(row => row.id)).toEqual([preparing]);
    expect(result.dispatched.map(row => row.id)).toEqual([dispatched]);
    expect(result.delivered.map(row => row.id)).toEqual([delivered, boundary]);
  });
  it("only includes confirmed Cash on Delivery or paid Orders in ready to prepare", async () => {
    const cod = await order("confirmed");
    const pickup = await order("confirmed", "cash-on-delivery", "pickup");
    const paid = await order("paid", "gcash");
    await order("placed");
    await order("confirmed", "gcash");
    await order("awaiting payment", "gcash");
    await order("cancelled");

    expect((await board()).ready.map(row => row.id).sort()).toEqual([cod, pickup, paid].sort());
  });
});
