import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { loadOrderReturnSummary, returnOutcome } from "@/features/returns/outcome";
import { loadReturnDetail, loadReturns } from "@/features/returns/returns";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate order_returns, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
  await db.sql`insert into orders (customer_id, status, delivered_at, payment_method, subtotal_in_centavos) values ('c1', 'delivered', now(), 'gcash', 300000)`;
});
const connect = () => db.sql;

it("calls a refund Completed, and a replacement Completed only once its Replacement Order is delivered", () => {
  expect(returnOutcome("refunded")).toEqual({ label: "Completed · Refunded", completed: true });
  expect(returnOutcome("replaced", { orderId: 2, status: "preparing" })).toEqual({ label: "Replacement in progress", completed: false });
  expect(returnOutcome("replaced", { orderId: 2, status: "delivered" })).toEqual({ label: "Completed · Replaced", completed: true });
  expect(returnOutcome("replaced", { orderId: 2, status: "received" })?.completed).toBe(true);
  expect(returnOutcome("replaced", { orderId: 2, status: "cancelled" })).toEqual({ label: "Replacement cancelled", completed: false });
  expect(returnOutcome("replaced", null)).toEqual({ label: "Completed · Replaced", completed: true });
  for (const status of ["requested", "approved", "goods received", "declined", "cancelled"] as const) expect(returnOutcome(status)).toBeNull();
});

it("reads each Return's Replacement Order and summarises the Order's Returns for any viewer", async () => {
  const [refund] = await db.sql`insert into order_returns (order_id, reason, amount_in_centavos, status, refunded_at, refund_amount_in_centavos, refund_paid_method)
    values (1, 'damaged', 120000, 'refunded', now(), 120000, 'gcash') returning id`;
  const [replace] = await db.sql`insert into order_returns (order_id, reason, amount_in_centavos, status, preferred_resolution, final_resolution, replaced_at)
    values (1, 'defective', 60000, 'replaced', 'replacement', 'replacement', now()) returning id`;
  await db.sql`insert into order_returns (order_id, reason, amount_in_centavos, status, decline_reason) values (1, 'other', 1000, 'declined', 'Normal wear')`;
  await db.sql`insert into order_returns (order_id, reason, amount_in_centavos, status) values (1, 'other', 1000, 'cancelled')`;
  const [created] = await db.sql`insert into orders (customer_id, status, payment_method, subtotal_in_centavos, replacement_for_order_id, replacement_for_return_id)
    values ('c1', 'dispatched', 'gcash', 0, 1, ${replace.id}) returning id`;

  const summary = await loadOrderReturnSummary(connect, 1);
  expect(summary).toEqual({ replacementFor: null, returns: [
    { id: refund.id, number: `RMA-${refund.id}`, label: "Completed · Refunded", detail: "₱1,200.00 by GCash", replacementOrderId: null },
    { id: replace.id, number: `RMA-${replace.id}`, label: "Replacement in progress", detail: `Replacement Order #${created.id}`, replacementOrderId: created.id },
    { id: 3, number: "RMA-3", label: "Rejected", detail: "Normal wear", replacementOrderId: null },
  ] });
  expect(await loadOrderReturnSummary(connect, created.id)).toEqual({ returns: [], replacementFor: { orderId: 1, returnId: replace.id } });

  const list = await loadReturns(connect, { status: "replaced" });
  expect(list.ok && list.list.rows[0].replacement).toEqual({ orderId: created.id, status: "dispatched" });
  await db.sql`update orders set status = 'delivered' where id = ${created.id}`;
  const detail = await loadReturnDetail(connect, replace.id);
  expect(detail.ok && detail.detail?.replacement).toEqual({ orderId: created.id, status: "delivered" });
  expect((await loadOrderReturnSummary(connect, 1))?.returns[1].label).toBe("Completed · Replaced");
});

it("returns null rather than failing the Order when its Returns cannot be read", async () => {
  expect(await loadOrderReturnSummary(() => { throw new Error("down"); }, 1)).toBeNull();
});
