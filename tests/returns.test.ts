import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadReturns, loadReturnStats, loadReturnDetail } from "@/features/returns/returns";
import { FakeStorefront, FAKE_STOREFRONT_URL } from "./fake-storefront";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate order_return_history, order_return_images, order_return_items, order_returns,
    ticket_messages, tickets, order_delivery_addresses, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
  await db.sql`insert into orders (customer_id, status, delivered_at) values ('c1', 'delivered', '2026-10-20T00:00:00Z')`;
});
async function request(status: string, at: string) {
  const [row] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, status, reason, amount_in_centavos, requested_at)
    values (1, ${status}, 'damaged', 10000, ${new Date(at)}) returning id`;
  return row.id;
}
async function list(query: Parameters<typeof loadReturns>[1] = {}) {
  const result = await loadReturns(() => db.sql, query);
  if (!result.ok) throw new Error("Expected Returns to load");
  return result.list;
}
describe("Returns read model", () => {
  it("reads legacy Order context even before the Delivery photo column is deployed", async () => {
    const id = await request('requested', '2026-10-20T01:00:00Z');
    await db.sql`alter table orders drop column delivery_photo_file_id`;
    try {
      expect(await loadReturnDetail(() => db.sql, id)).toMatchObject({ ok: true, detail: { deliveryPhotoFileId: null } });
    } finally {
      await db.sql`alter table orders add column delivery_photo_file_id text`;
    }
  });
  it("distinguishes empty, missing and unavailable data", async () => {
    expect(await loadReturns(() => db.sql)).toMatchObject({ ok: true, list: { rows: [], total: 0 } });
    expect(await loadReturnStats(() => db.sql)).toMatchObject({ ok: true, stats: { returnRate: 0, refundedThisMonth: 0 } });
    expect(await loadReturnDetail(() => db.sql, 999)).toEqual({ ok: true, detail: null });
    const unavailable = () => { throw new Error('Database offline'); };
    expect(await loadReturns(unavailable)).toEqual({ ok: false });
    expect(await loadReturnStats(unavailable)).toEqual({ ok: false });
    expect(await loadReturnDetail(unavailable, 1)).toEqual({ ok: false });
  });

  it("enforces the 24-hour request cutoff without expiring an existing Return", async () => {
    const [line] = await db.sql`insert into order_lines (order_id, product_name, quantity, price_in_centavos)
      values (1, 'Halaya', 1, 10000) returning id`;
    let now = new Date('2026-10-20T23:59:59.999Z');
    const storefront = new FakeStorefront(db.sql, () => now);
    const submit = () => storefront.handle(new Request(`${FAKE_STOREFRONT_URL}/api/orders/1/returns`, {
      method: 'POST', headers: { 'X-Test-Customer': 'c1' },
      body: JSON.stringify({ lineIds: [line.id], reason: 'defective', note: '', imageFileIds: ['defect'] }),
    }));
    expect((await submit()).status).toBe(201);
    now = new Date('2026-10-21T00:00:00Z');
    expect(await (await submit()).json()).toEqual({ error: 'The 24-hour Refund window is closed.' });
    now = new Date('2026-11-01T00:00:00Z');
    expect((await list()).rows).toEqual([expect.objectContaining({ status: 'requested' })]);
  });
  it("reads a Return requested through the fake storefront within the Refund window", async () => {
    const [line] = await db.sql`insert into order_lines (order_id, product_name, size_label, quantity, price_in_centavos)
      values (1, 'Halaya', 'Small', 2, 5000) returning id`;
    await db.sql`update orders set subtotal_in_centavos = 10000, delivery_fee_in_centavos = 1500 where id = 1`;
    const storefront = new FakeStorefront(db.sql, () => new Date('2026-10-20T23:59:59.999Z'));
    const response = await storefront.handle(new Request(`${FAKE_STOREFRONT_URL}/api/orders/1/returns`, {
      method: 'POST', headers: { 'X-Test-Customer': 'c1' },
      body: JSON.stringify({ lineIds: [line.id], reason: 'damaged', note: 'Leaking jar', imageFileIds: ['defect-1'] }),
    }));
    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect((await list()).rows).toEqual([expect.objectContaining({ id, amount: 11500, status: 'requested' })]);
    const result = await loadReturnDetail(() => db.sql, id);
    expect(result).toMatchObject({ ok: true, detail: { note: 'Leaking jar',
      history: [{ status: 'requested', actor: { type: 'customer', id: 'c1', name: 'Maria Santos' } }] } });
  });
  it("exposes the reason, evidence, amount and accountable history of one Return", async () => {
    const id = await request('refunded', '2026-10-20T01:00:00Z');
    await db.sql`update orders set payment_method = 'gcash', delivery_photo_file_id = 'delivery-photo' where id = 1`;
    await db.sql`update order_returns set reason = 'wrong item', note = 'Different flavour arrived',
      goods_required = false, refunded_at = '2026-10-22T00:00:00Z' where id = ${id}`;
    await db.sql`insert into order_return_images (return_id, position, file_id) values
      (${id}, 2, 'defect-2'), (${id}, 1, 'defect-1')`;
    await db.sql`insert into order_return_history (return_id, status, actor_type, actor_id, actor_name, occurred_at) values
      (${id}, 'refunded', 'staff', 'ben', 'Ben Cruz', '2026-10-22T00:00:00Z'),
      (${id}, 'requested', 'customer', 'c1', 'Maria Santos', '2026-10-20T01:00:00Z'),
      (${id}, 'approved', 'staff', 'ana', 'Ana Reyes', '2026-10-21T00:00:00Z')`;
    const result = await loadReturnDetail(() => db.sql, id);
    expect(result).toMatchObject({ ok: true, detail: {
      id, number: `RMA-${id}`, orderId: 1, amount: 10000, reason: 'wrong item', note: 'Different flavour arrived', goodsRequired: false,
      paymentMethod: 'gcash', deliveryPhotoFileId: 'delivery-photo', refundWindowEndsAt: new Date('2026-10-21T00:00:00Z'),
      images: [{ fileId: 'defect-1', position: 1 }, { fileId: 'defect-2', position: 2 }],
      history: [
        { status: 'requested', actor: { type: 'customer', id: 'c1', name: 'Maria Santos' }, at: new Date('2026-10-20T01:00:00Z') },
        { status: 'approved', actor: { type: 'staff', id: 'ana', name: 'Ana Reyes' }, at: new Date('2026-10-21T00:00:00Z') },
        { status: 'refunded', actor: { type: 'staff', id: 'ben', name: 'Ben Cruz' }, at: new Date('2026-10-22T00:00:00Z') },
      ],
    } });
  });
  it("calculates open work and monthly figures at Philippine month boundaries", async () => {
    await request('requested', '2026-09-30T16:00:00Z');
    await request('approved', '2026-09-20T00:00:00Z');
    await request('goods received', '2026-09-21T00:00:00Z');
    const refunded = await request('refunded', '2026-09-22T00:00:00Z');
    const previous = await request('refunded', '2026-09-22T00:00:00Z');
    await request('declined', '2026-10-15T00:00:00Z');
    await request('cancelled', '2026-10-31T16:00:00Z');
    await db.sql`update order_returns set amount_in_centavos = 25000, refunded_at = '2026-10-31T15:59:59.999Z' where id = ${refunded}`;
    await db.sql`update order_returns set refunded_at = '2026-09-30T15:59:59.999Z' where id = ${previous}`;
    await db.sql`insert into orders (customer_id, status, delivered_at) values
      ('c1', 'delivered', '2026-09-30T16:00:00Z'), ('c1', 'received', '2026-10-12T00:00:00Z'),
      ('c1', 'delivered', '2026-10-31T15:59:59.999Z'), ('c1', 'delivered', '2026-10-31T16:00:00Z'),
      ('c1', 'delivered', '2026-09-30T15:59:59.999Z')`;
    expect(await loadReturnStats(() => db.sql, new Date('2026-10-23T00:00:00Z'))).toEqual({ ok: true,
      stats: { openReturns: 3, requestedThisMonth: 2, deliveredThisMonth: 4, returnRate: 50, refundedThisMonth: 25000 } });
  });
  it("provides item snapshots and pages a status-filtered list without losing counts", async () => {
    const first = await request('requested', '2026-10-21T00:00:00Z');
    const second = await request('requested', '2026-10-22T00:00:00Z');
    await request('approved', '2026-10-20T00:00:00Z');
    const [line] = await db.sql`insert into order_lines (order_id, product_name, quantity, price_in_centavos)
      values (1, 'Renamed product', 2, 5000) returning id`;
    await db.sql`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos)
      values (${second}, ${line.id}, 'Halaya', 'Small', 2, 5000)`;
    const result = await list({ status: 'requested', page: 2, pageSize: 1 });
    expect(result).toMatchObject({ page: 2, pageSize: 1, total: 2, totalPages: 2,
      counts: { requested: 2, approved: 1 }, rows: [{ id: second, items: [{ orderLineId: line.id, product: 'Halaya', size: 'Small', quantity: 2, price: 5000 }] }] });
    expect((await list({ status: 'requested', pageSize: 1 })).rows[0].id).toBe(first);
    expect((await list({ orderId: 999 })).rows).toEqual([]);
  });
  it("puts Requested first, oldest first, and breaks ties by Return number", async () => {
    const approved = await request('approved', '2026-10-01T00:00:00Z');
    const newer = await request('requested', '2026-10-22T00:00:00Z');
    const oldest = await request('requested', '2026-10-21T00:00:00Z');
    const tie = await request('requested', '2026-10-21T00:00:00Z');
    const rows = (await list()).rows;
    expect(rows.map(row => row.id)).toEqual([oldest, tie, newer, approved]);
    expect(rows[0]).toMatchObject({ number: `RMA-${oldest}`, customer: { id: 'c1', name: 'Maria Santos' }, orderId: 1 });
  });
});
