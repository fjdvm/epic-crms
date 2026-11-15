import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadLineReservations, loadStock, shopShows } from "@/features/orders/stock";
import type { ImsSizeStock } from "@/lib/storefront";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create table products (slug text primary key, name text not null)`;
  await db.sql`create table sizes (id integer primary key, product_slug text not null, label text not null, price_in_centavos integer not null)`;
  await db.sql`create table stock_reservations (id text primary key, order_id integer, state text not null, lines jsonb not null)`;
}, 60_000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await db.sql`truncate stock_reservations, sizes, products`;
  await db.sql`truncate order_delivery_addresses, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, first_name, email) values ('c1', 'Maria', 'Maria', 'm@example.com')`;
  await db.sql`insert into orders (id, customer_id, status) overriding system value values (7, 'c1', 'confirmed')`;
  await db.sql`insert into products values ('halaya', 'Ube Halaya Smooth'), ('powder', '120 Mesh Ube Powder')`;
  await db.sql`insert into sizes values (1, 'halaya', 'Tub 340 g', 39000), (2, 'halaya', 'Jar 250 g', 25000), (3, 'powder', '500 g', 90000)`;
});

const ims = (entries: [number, number, number, number][]) => async () =>
  new Map<number, ImsSizeStock>(entries.map(([sizeId, quantity, reserved, available]) => [sizeId, { sizeId, quantity, reserved, available }]));

describe("Products & stock", () => {
  it("shows in stock, reserved, available and what the shop shows, with low and sold-out counted", async () => {
    const result = await loadStock(() => db.sql, ims([[1, 26, 8, 18], [2, 12, 5, 7], [3, 0, 0, 0]]));
    if (!result.ok) throw new Error("expected stock");
    expect(result.page.rows.map((r) => [r.product, r.size, r.inStock, r.reserved, r.available, r.shows])).toEqual([
      ["120 Mesh Ube Powder", "500 g", 0, 0, 0, "Sold out"],
      ["Ube Halaya Smooth", "Jar 250 g", 12, 5, 7, { left: 7 }],
      ["Ube Halaya Smooth", "Tub 340 g", 26, 8, 18, "In stock"],
    ]);
    expect(result.page.summary).toEqual({ sizes: 3, soldOut: 1, reserved: 13, low: 1 });
    expect(result.page.imsReachable).toBe(true);
  });

  it("says the IMS is unreachable and shows no quantity rather than guessing", async () => {
    const result = await loadStock(() => db.sql, async () => null);
    if (!result.ok) throw new Error("expected stock");
    expect(result.page.imsReachable).toBe(false);
    expect(result.page.rows.every((r) => r.available === null && r.shows === "Unknown")).toBe(true);
  });

  it("is unavailable when the database cannot be read", async () => {
    expect(await loadStock(() => { throw new Error("down"); }, ims([]))).toEqual({ ok: false });
  });

  it("matches the shop's wording: Only N left under 10, sold out at 0", () => {
    expect([shopShows(10), shopShows(9), shopShows(0), shopShows(null)]).toEqual(["In stock", { left: 9 }, "Sold out", "Unknown"]);
  });
});

describe("Order detail reservations", () => {
  const reserve = (state: string, lines: object[]) =>
    db.sql`insert into stock_reservations values ('r1', 7, ${state}, ${db.sql.json(lines as never)})`;

  it("gives each line's reserved quantity and what is left of that Size", async () => {
    await reserve("placed", [{ orderLineId: 11, sizeId: 1, quantity: 4 }, { orderLineId: 12, sizeId: 2, quantity: 2 }]);
    const map = await loadLineReservations(() => db.sql, 7, ims([[1, 26, 8, 18], [2, 12, 5, 9]]));
    expect([...map]).toEqual([[11, { reserved: 4, left: 18 }], [12, { reserved: 2, left: 9 }]]);
  });

  it("reserves nothing once the Order is dispatched, because the IMS took the stock out at packing", async () => {
    await reserve("placed", [{ orderLineId: 11, sizeId: 1, quantity: 4 }]);
    await db.sql`update orders set status = 'dispatched' where id = 7`;
    expect((await loadLineReservations(() => db.sql, 7, ims([[1, 26, 8, 18]]))).size).toBe(0);
  });

  it("reserves nothing for a released or cancelled line, or an Order placed before Reservations", async () => {
    await reserve("placed", [{ orderLineId: 11, sizeId: 1, quantity: 4, released: true }, { orderLineId: 12, sizeId: 2, quantity: 2, release: true }]);
    expect((await loadLineReservations(() => db.sql, 7, ims([]))).size).toBe(0);
    expect((await loadLineReservations(() => db.sql, 99, ims([]))).size).toBe(0);
  });

  it("still shows the reserved quantity when the IMS cannot say what is left", async () => {
    await reserve("placed", [{ orderLineId: 11, sizeId: 1, quantity: 4 }]);
    expect([...(await loadLineReservations(() => db.sql, 7, async () => null))]).toEqual([[11, { reserved: 4, left: null }]]);
  });

  it("never fails the Order detail when the Reservation cannot be read", async () => {
    expect((await loadLineReservations(() => { throw new Error("no grant"); }, 7, ims([]))).size).toBe(0);
  });
});
