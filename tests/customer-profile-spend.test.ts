import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getCustomerProfile } from "@/features/customer-profiles/profile";
import { listCustomers } from "@/features/customer-profiles/customers";
import { paymentStatusOf } from "@/features/customer-profiles/rules";
import { loadFulfilmentBoard } from "@/features/orders/fulfilment";
import { paymentRows, summarize } from "@/features/orders/payments";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date('2026-10-23T00:00:00Z');
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql.unsafe(`
    alter table customers add column middle_name text, add column last_name text not null default '',
      add column contact_number text not null default '';
    create table addresses (id integer primary key, customer_id text references customers(id), label text,
      street text, barangay text, city text, province text, postal_code text, country text, is_default boolean);
    create table products (slug text primary key, name text);
    create table sizes (id integer primary key, product_slug text references products(slug), label text, price_in_centavos integer);
    create table cart_lines (id integer primary key, customer_id text references customers(id), size_id integer references sizes(id), quantity integer);
  `);
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate order_returns, orders, customers, neon_auth."user" restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values
    ('c1', 'Maria Santos', 'maria@example.com'), ('c2', 'Jose Reyes', 'jose@example.com')`;
  await db.sql`insert into neon_auth."user" (id, "emailVerified") values ('c1', true), ('c2', true)`;
});
async function order(status: string, subtotal = 100000, fee: number | null = 15000, customer = 'c1', at = '2026-10-22T00:00:00Z') {
  const [row] = await db.sql<{ id: number }[]>`insert into orders
    (customer_id, status, subtotal_in_centavos, delivery_fee_in_centavos, created_at)
    values (${customer}, ${status}, ${subtotal}, ${fee}, ${new Date(at)}) returning id`;
  return row.id;
}
async function profile(id = 'c1') {
  const result = await getCustomerProfile(db.sql, id, now);
  if (!result) throw new Error('Expected a Customer Profile');
  return result;
}
describe('Customer Profile Total spent', () => {
  it('keeps received Orders settled and in recent deliveries after Customer acknowledgement', async () => {
    const cod = await order('received');
    const gcash = await order('received');
    await db.sql`update orders set delivered_at = '2026-10-22T12:00:00Z' where id in (${cod}, ${gcash})`;
    await db.sql`update orders set payment_method = 'gcash', payment_proof_submitted_at = '2026-10-21T00:00:00Z' where id = ${gcash}`;
    const payments = summarize(await paymentRows(db.sql, now), now);
    expect(payments.paid).toEqual({ count: 2, centavos: 230000 });
    expect(payments.collected).toEqual({ count: 1, centavos: 115000 });
    const board = await loadFulfilmentBoard(() => db.sql, { now });
    expect(board.ok && board.board.delivered.map(row => row.id)).toEqual([cod, gcash]);
    expect(board.ok && board.board.ready).toEqual([]);
  });
  it.each(['requested', 'approved', 'goods received', 'declined', 'cancelled'])('%s Returns leave Total spent unchanged', async status => {
    const id = await order('received');
    await db.sql`insert into order_returns (order_id, status, reason, amount_in_centavos) values (${id}, ${status}, 'damaged', 115000)`;
    expect(await profile()).toMatchObject({ totalSpent: 115000, averageOrder: 115000, orders: 1, stage: 'first-order' });
    expect((await listCustomers(db.sql, { now })).rows.find(row => row.id === 'c1')?.totalSpent).toBe(115000);
  });

  it('keeps Order counts, original totals and Stage after a full refund', async () => {
    const id = await order('received');
    await order('paid', 50000, null, 'c1', '2026-06-01T00:00:00Z');
    await order('cancelled', 77777, null, 'c1', '2026-10-23T00:00:00Z');
    await db.sql`insert into order_returns (order_id, status, reason, amount_in_centavos) values (${id}, 'refunded', 'damaged', 115000)`;
    const result = await profile();
    expect(result).toMatchObject({ totalSpent: 50000, averageOrder: 25000, orders: 3, stage: 'repeat', lastOrder: new Date('2026-10-22T00:00:00Z') });
    expect(result.orderHistory.find(row => row.id === id)).toMatchObject({ total: 115000, status: 'received' });
    expect((await listCustomers(db.sql, { now, stage: 'repeat' })).rows).toEqual([expect.objectContaining({ id: 'c1', totalSpent: 50000 })]);
  });

  it.each([[70, 'at-risk'], [130, 'lost']] as const)('keeps the %s-day Stage when a received Order is fully refunded', async (days, stage) => {
    const at = new Date(now.getTime() - days * 86400000);
    const id = await order('received', 100000, null, 'c1', at.toISOString());
    await db.sql`insert into order_returns (order_id, status, reason, amount_in_centavos) values (${id}, 'refunded', 'other', 100000)`;
    expect(await profile()).toMatchObject({ totalSpent: 0, averageOrder: 0, stage, lastOrder: at });
    expect((await listCustomers(db.sql, { now, stage })).rows).toEqual([expect.objectContaining({ id: 'c1', totalSpent: 0 })]);
  });
  it('subtracts each Refunded amount once without multiplying Orders or changing Stage', async () => {
    const mine = await order('received');
    const other = await order('delivered', 90000, null, 'c2');
    await db.sql`insert into order_returns (order_id, status, reason, amount_in_centavos) values
      (${mine}, 'refunded', 'damaged', 25000), (${mine}, 'refunded', 'wrong item', 10000),
      (${other}, 'refunded', 'other', 90000)`;
    expect(await profile()).toMatchObject({ totalSpent: 80000, averageOrder: 80000, orders: 1, stage: 'first-order' });
    const rows = (await listCustomers(db.sql, { now, sort: 'totalSpent', direction: 'desc' })).rows;
    expect(rows.map(row => [row.id, row.totalSpent])).toEqual([['c1', 80000], ['c2', 0]]);
  });
  it('counts received Orders as paid/fulfilled on the profile and the Customer list', async () => {
    await order('received');
    expect(await profile()).toMatchObject({ totalSpent: 115000, averageOrder: 115000, stage: 'first-order', orders: 1 });
    expect((await listCustomers(db.sql, { now })).rows.find(row => row.id === 'c1')).toMatchObject({ totalSpent: 115000, stage: 'first-order' });
    expect(paymentStatusOf('received')).toBe('Paid');
  });
});
