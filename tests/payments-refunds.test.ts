import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { loadRefunds } from "@/features/orders/refunds";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate order_returns, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
  await db.sql`insert into orders (customer_id, status, payment_method, subtotal_in_centavos) values ('c1', 'delivered', 'gcash', 300000)`;
});

const NOW = new Date("2026-11-22T00:00:00Z");

it("lists refunds of the last 30 days, newest first, with the recorded amount, method, reference and who settled it", async () => {
  const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
  const [recorded] = await db.sql`insert into order_returns (order_id, reason, amount_in_centavos, status, refunded_at, refund_amount_in_centavos, refund_paid_method, refund_reference, refund_delivery_fee_in_centavos)
    values (1, 'defective', 100000, 'refunded', ${day(2)}, 110000, 'gcash', 'GC-9981', 10000) returning id`;
  await db.sql`insert into order_return_history (return_id, status, actor_type, actor_id, actor_name, occurred_at) values (${recorded.id}, 'refunded', 'staff', 'mario', 'Mario Cruz', ${day(2)})`;
  const [legacy] = await db.sql`insert into order_returns (order_id, reason, amount_in_centavos, status, refunded_at, refund_delivery_fee_in_centavos)
    values (1, 'damaged', 50000, 'refunded', ${day(1)}, 5000) returning id`;
  await db.sql`insert into order_returns (order_id, reason, amount_in_centavos, status, refunded_at) values (1, 'damaged', 1, 'refunded', ${day(31)})`;
  await db.sql`insert into order_returns (order_id, reason, amount_in_centavos, status) values (1, 'damaged', 1, 'approved')`;

  expect(await loadRefunds(db.sql, NOW)).toEqual([
    { returnId: legacy.id, number: `RMA-${legacy.id}`, orderId: 1, customer: "Maria Santos", amountInCentavos: 55000, method: null, reference: null, settledBy: null, refundedAt: day(1) },
    { returnId: recorded.id, number: `RMA-${recorded.id}`, orderId: 1, customer: "Maria Santos", amountInCentavos: 110000, method: "gcash", reference: "GC-9981", settledBy: "Mario Cruz", refundedAt: day(2) },
  ]);
});
