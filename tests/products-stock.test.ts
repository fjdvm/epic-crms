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

describe("Orders holding a Size's Reservation", () => {
  const hold = async (id: string, orderId: number, lines: object[], state = "placed") =>
    db.sql`insert into stock_reservations values (${id}, ${orderId}, ${state}, ${db.sql.json(lines as never)})`;
  const addOrder = async (id: number, status: string) => {
    await db.sql`insert into customers (id, full_name, first_name, email) values (${`c${id}`}, ${`Customer ${id}`}, 'C', ${`c${id}@example.com`})`;
    await db.sql`insert into orders (id, customer_id, status) overriding system value values (${id}, ${`c${id}`}, ${status})`;
  };
  const holders = async (sizeId: number) => {
    const result = await loadStock(() => db.sql, ims([[1, 26, 8, 18], [2, 12, 5, 7], [3, 0, 0, 0]]));
    if (!result.ok) throw new Error("expected stock");
    return result.page.rows.find((r) => r.sizeId === sizeId)!.orders;
  };

  it("lists each Order holding the Size with Customer, status label and quantity", async () => {
    await addOrder(8, "awaiting payment"); await addOrder(9, "paid"); await addOrder(10, "preparing");
    await hold("r1", 7, [{ orderLineId: 1, sizeId: 1, quantity: 4 }]);
    await hold("r2", 8, [{ orderLineId: 2, sizeId: 1, quantity: 2 }, { orderLineId: 3, sizeId: 2, quantity: 1 }]);
    await hold("r3", 9, [{ orderLineId: 4, sizeId: 1, quantity: 1 }]);
    await hold("r4", 10, [{ orderLineId: 5, sizeId: 1, quantity: 1 }]);
    await db.sql`update orders set status = 'placed' where id = 7`;
    expect(await holders(1)).toEqual([
      { orderId: 7, customer: "Maria", status: "Placed", quantity: 4 },
      { orderId: 8, customer: "Customer 8", status: "Awaiting payment", quantity: 2 },
      { orderId: 9, customer: "Customer 9", status: "Paid and waiting to dispatch", quantity: 1 },
      { orderId: 10, customer: "Customer 10", status: "Paid and waiting to dispatch", quantity: 1 },
    ]);
    expect((await holders(2))!.map((o) => o.orderId)).toEqual([8]);
  });

  it("counts an Order once even when two lines hold the same Size", async () => {
    await hold("r1", 7, [{ orderLineId: 1, sizeId: 1, quantity: 2 }, { orderLineId: 2, sizeId: 1, quantity: 3 }]);
    expect(await holders(1)).toEqual([{ orderId: 7, customer: "Maria", status: "Awaiting payment", quantity: 5 }]);
  });

  it("drops an Order the moment its Reservation is released, cancelled or taken out by dispatch", async () => {
    await addOrder(8, "cancelled"); await addOrder(9, "dispatched"); await addOrder(11, "paid");
    await hold("r1", 7, [{ orderLineId: 1, sizeId: 1, quantity: 2, released: true }]);
    await hold("r2", 8, [{ orderLineId: 2, sizeId: 1, quantity: 2 }]);
    await hold("r3", 9, [{ orderLineId: 3, sizeId: 1, quantity: 2 }]);
    await hold("r4", 11, [{ orderLineId: 4, sizeId: 1, quantity: 2 }], "released");
    expect(await holders(1)).toEqual([]);
  });

  it("still shows stock when the Orders cannot be read", async () => {
    await hold("r1", 7, [{ orderLineId: 1, sizeId: 1, quantity: 2 }]);
    await db.sql`alter table stock_reservations rename to stock_reservations_x`;
    try {
      expect(await holders(1)).toBeNull();
    } finally {
      await db.sql`alter table stock_reservations_x rename to stock_reservations`;
    }
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
