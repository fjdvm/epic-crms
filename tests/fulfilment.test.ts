import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadFulfilmentBoard, ordersOnTab, type FulfilmentTab } from "@/features/orders/fulfilment";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date("2026-10-23T04:00:00Z");

beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate failed_deliveries, order_delivery_addresses, order_lines, orders, customers restart identity cascade`;
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
  const { board } = result;
  const tab = (name: FulfilmentTab) => ordersOnTab(board, name);
  return { board, tab };
}

async function failedAttempt(orderId: number, rebooked = false) {
  await db.sql`insert into failed_deliveries (id, order_id, reason, next_step, customer_message, staff_id, staff_name, rebooked_at)
    values (${`00000000-0000-0000-0000-${String(orderId).padStart(12, "0")}`}, ${orderId}, 'Customer not home', 'rebook', 'x', 'u1', 'Liza', ${rebooked ? new Date() : null})`;
}

describe("Fulfilment board data", () => {
  it("returns all four empty columns when no Orders need Fulfilment", async () => {
    expect((await board()).board).toEqual({ orders: [] });
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
    expect((await board()).tab("to-pack")).toEqual([{
      id, customerId: "c1", customerName: "Maria Santos", createdAt, deliveredAt: null, failedOpen: false, packedBy: null,
      status: "confirmed", fulfillmentMethod: "delivery", paymentMethod: "cash-on-delivery",
      paymentLabel: "Unpaid", total: 115000, lines: [{ product: "Halaya", quantity: 2 }],
    }]);
  });
  it("returns who packed a Preparing Order", async () => {
    const id = await order("preparing");
    await db.sql`update orders set packed_by_id = 'u1', packed_by_name = 'Liza B.', packed_at = now() where id = ${id}`;
    expect((await board()).tab("preparing")[0].packedBy).toEqual({ name: "Liza B." });
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
    expect(result.tab("to-pack")).toEqual([]);
    expect(result.tab("preparing").map(row => row.id)).toEqual([preparing]);
    expect(result.tab("out-for-delivery").map(row => row.id)).toEqual([dispatched]);
    expect(result.tab("completed").map(row => row.id)).toEqual([delivered, boundary]);
  });
  it("keeps a dispatched Order with an open failed delivery on Out for delivery, and lists it on Failed until it is closed", async () => {
    const failed = await order("dispatched");
    const rebooked = await order("dispatched");
    const clean = await order("dispatched");
    await failedAttempt(failed);
    await failedAttempt(rebooked, true);
    const result = await board();
    expect(result.tab("failed").map(row => row.id)).toEqual([failed]);
    expect(result.tab("out-for-delivery").map(row => row.id)).toEqual([failed, rebooked, clean]);
  });
  it("lists Completed by the original completion time, including received Orders", async () => {
    const received = await order("received");
    const delivered = await order("delivered", "cash-on-delivery");
    const out = await order("dispatched", "cash-on-delivery");
    const stale = await order("received");
    await db.sql`update orders set delivered_at = ${new Date("2026-10-21T04:00:00Z")} where id = ${received}`;
    await db.sql`update orders set delivered_at = ${new Date("2026-10-22T04:00:00Z")} where id = ${delivered}`;
    await db.sql`update orders set delivered_at = ${new Date("2026-10-01T04:00:00Z")} where id = ${stale}`;
    const result = await board();
    expect(result.tab("completed").map(row => row.id)).toEqual([delivered, received]);
    expect(result.tab("out-for-delivery").map(row => row.id)).toEqual([out]);
    expect(result.tab("all").map(row => row.id).sort()).toEqual([received, delivered, out].sort());
    expect(result.tab("all-active").map(row => row.id)).toEqual([out]);
  });
  it("shows To pack oldest first and never an unpaid Online Order", async () => {
    const newer = await order("paid", "gcash");
    const older = await order("confirmed");
    await order("confirmed", "gcash");
    await order("awaiting payment", "maya");
    await db.sql`update orders set created_at = '2026-01-01T00:00:00Z' where id = ${older}`;
    expect((await board()).tab("to-pack").map(row => row.id)).toEqual([older, newer]);
  });
  it("only includes confirmed Cash on Delivery or paid Orders in ready to prepare", async () => {
    const cod = await order("confirmed");
    const paid = await order("paid", "gcash");
    await order("placed");
    await order("confirmed", "gcash");
    await order("awaiting payment", "gcash");
    await order("cancelled");

    expect((await board()).tab("to-pack").map(row => row.id).sort()).toEqual([cod, paid].sort());
  });
});
