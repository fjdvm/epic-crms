import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadLineReservations, loadStock, loadStockCopy, loadStockSize, shopShows, summarize, withSize } from "@/features/orders/stock";
import type { ImsProduct, ImsSizeStock } from "@/lib/storefront";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create table products (slug text primary key, name text not null)`;
  await db.sql`create table sizes (id integer primary key, product_slug text not null, label text not null, price_in_centavos integer not null, ims_product_id integer)`;
  await db.sql`create table stock_reservations (id text primary key, order_id integer, state text not null, lines jsonb not null)`;
}, 60_000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await db.sql`truncate stock_reservations, sizes, products`;
  await db.sql`truncate order_delivery_addresses, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, first_name, email) values ('c1', 'Maria', 'Maria', 'm@example.com')`;
  await db.sql`insert into orders (id, customer_id, status) overriding system value values (7, 'c1', 'confirmed')`;
  await db.sql`insert into products values ('halaya', 'Ube Halaya Smooth'), ('powder', '120 Mesh Ube Powder')`;
  await db.sql`insert into sizes values (1, 'halaya', 'Tub 340 g', 39000, 101), (2, 'halaya', 'Jar 250 g', 25000, 102), (3, 'powder', '500 g', 90000, 103)`;
});

/** The IMS product feed for the Sizes seeded above. IMS product ids are the Size id + 100, so the two id spaces never coincide. */
const feedOfSeed = async (): Promise<ImsProduct[]> => (await db.sql<{ id: number; name: string; label: string }[]>`
  select s.ims_product_id as id, p.name, s.label from sizes s join products p on p.slug = s.product_slug order by s.id`)
  .map((row) => ({ productId: row.id, name: row.name, variant: row.label, image: "img", price: 100, active: true }));

/** What CREOMS published: by default every product has a shop image and a price, so it is on the shop. */
type Content = { description: string; imageUrl: string | null; name: string | null; price: number | null };
const priced = (over: Record<number, Partial<Content>> = {}) => async (ids: number[]) =>
  new Map(ids.map((id) => [id, { description: "", imageUrl: "img", name: null, price: 100, ...over[id] }]));

const ims = (entries: [number, number, number, number][]) => async () =>
  new Map<number, ImsSizeStock>(entries.map(([sizeId, quantity, reserved, available]) => [sizeId, { sizeId, quantity, reserved, available }]));

describe("Products & stock", () => {
  it("shows in stock, CREOMS's own reserved, available and what the shop shows, with low and sold-out counted", async () => {
    const result = await loadStock(() => db.sql, ims([[101, 26, 8, 18], [102, 12, 5, 7], [103, 0, 0, 0]]), feedOfSeed, priced());
    if (!result.ok) throw new Error("expected stock");
    expect(result.page.rows.map((r) => [r.product, r.size, r.inStock, r.reserved, r.available, r.shows])).toEqual([
      ["120 Mesh Ube Powder", "500 g", 0, 0, 0, "Sold out"],
      ["Ube Halaya Smooth", "Tub 340 g", 26, 0, 26, "In stock"],
      ["Ube Halaya Smooth", "Jar 250 g", 12, 0, 12, "In stock"],
    ]);
    expect(result.page.summary).toEqual({ sizes: 3, soldOut: 1, reserved: 0, low: 0 });
    expect(result.page.hasStock).toBe(true);
  });

  it("says the IMS is unreachable and shows no quantity rather than guessing", async () => {
    const result = await loadStock(() => db.sql, async () => null, feedOfSeed);
    if (!result.ok) throw new Error("expected stock");
    expect(result.page.hasStock).toBe(false);
    expect(result.page.rows.every((r) => r.available === null && r.shows === "Unknown")).toBe(true);
  });

  it("is unavailable when the IMS feed throws", async () => {
    expect(await loadStock(() => db.sql, ims([]), async () => { throw new Error("down"); })).toEqual({ ok: false });
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
    const result = await loadStock(() => db.sql, ims([[101, 26, 8, 18], [102, 12, 5, 7], [103, 0, 0, 0]]), feedOfSeed);
    if (!result.ok) throw new Error("expected stock");
    return result.page.rows.find((r) => r.sizeId === sizeId + 100)!.orders;
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

  it("attributes nothing to an IMS product when the Order line's Size is not linked to one", async () => {
    await db.sql`update sizes set ims_product_id = null where id = 1`;
    await hold("r1", 7, [{ orderLineId: 1, sizeId: 1, quantity: 2 }]);
    const result = await loadStock(() => db.sql, ims([[102, 12, 5, 7]]), async () => [{ productId: 102, name: "Ube Halaya Smooth", variant: "Jar 250 g", image: "img", price: 100, active: true }]);
    if (!result.ok) throw new Error("expected stock");
    expect(result.page.rows[0].orders).toEqual([]);
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

describe("Products & stock from the IMS product feed", () => {
  const product = (productId: number, over: Partial<ImsProduct> = {}): ImsProduct =>
    ({ productId, name: `Product ${productId}`, variant: "250g", image: `img-${productId}`, price: 120, active: true, ...over });
  const load = async (products: ImsProduct[] | null, stock: [number, number, number, number][] = [], content = priced()) => {
    const result = await loadStock(() => db.sql, ims(stock), async () => products, content);
    if (!result.ok) throw new Error("expected stock");
    return result.page;
  };

  it("lists a product the IMS holds even though the storefront has no Size for it", async () => {
    const page = await load([product(1), product(99, { name: "Ube Jam", variant: "500g" })], [[99, 5, 1, 4]]);
    const added = page.rows.find((r) => r.sizeId === 99)!;
    expect([added.product, added.size, added.available, added.marker]).toEqual(["Ube Jam", "500g", 5, null]);
    expect(page.rows.map((r) => r.sizeId).sort((a, b) => a - b)).toEqual([1, 99]);
  });

  it("shows a blank Variant as one unlabelled default Size", async () => {
    const page = await load([product(5, { variant: null })]);
    expect(page.rows[0].size).toBe("");
  });

  it("marks a product missing its name, or CREOMS's image or price, as Not on shop and lists what is missing", async () => {
    const content = async (ids: number[]) => new Map((await priced({ 2: { price: null }, 4: { name: "Ube Jam" } })(ids.filter((id) => id !== 1))));
    const page = await load([product(1, { name: "" }), product(2), product(3), product(4, { name: "" })], [], content);
    const marker = (id: number) => page.rows.find((r) => r.sizeId === id)!.marker;
    // The IMS image and price never put a product on the shop: CREOMS sets both.
    expect(marker(1)).toEqual({ kind: "not-on-shop", missing: ["name", "image", "price"] });
    expect(marker(2)).toEqual({ kind: "not-on-shop", missing: ["price"] });
    expect(marker(3)).toBeNull();
    // CREOMS's own name stands in for a blank IMS name.
    expect(marker(4)).toBeNull();
  });

  it("shows CREOMS's name and price, never the IMS price, and keeps the IMS name for reference", async () => {
    const page = await load([product(1, { name: "IMS Jam", price: 999 }), product(2, { name: "IMS Halaya", price: 999 })], [],
      priced({ 1: { name: "Ube Jam Extreme", price: 250 }, 2: { price: null } }));
    const row = (id: number) => page.rows.find((r) => r.sizeId === id)!;
    expect(row(1)).toMatchObject({ product: "Ube Jam Extreme", imsName: "IMS Jam", price: 250 });
    expect(row(2)).toMatchObject({ product: "IMS Halaya", imsName: "IMS Halaya", price: null });
  });

  it("keeps a discontinued product visible with its image and last known numbers", async () => {
    const page = await load([product(1, { active: false })], [[1, 9, 2, 7]], async () => new Map());
    expect(page.rows[0]).toMatchObject({ marker: { kind: "discontinued" }, image: "img-1", inStock: 9, reserved: 0, available: 9 });
  });

  it("does not count Not on shop or Discontinued products as on sale, low or sold out", async () => {
    const page = await load([product(1), product(2, { active: false }), product(3)], [[1, 20, 0, 20], [2, 0, 0, 0], [3, 0, 0, 0]], priced({ 3: { imageUrl: null } }));
    expect(page.summary).toEqual({ sizes: 1, soldOut: 0, reserved: 0, low: 0 });
  });

  it("lists nothing and says the IMS is unreachable when the feed cannot be read, never the storefront's own Sizes", async () => {
    const page = await load(null);
    expect(page.rows).toEqual([]);
    expect(page.hasStock).toBe(false);
  });
});

describe("Refetching one Size", () => {
  const item = (productId: number, name: string): ImsProduct => ({ productId, name, variant: "250 g", image: "/a.png", price: 100, active: true });
  const feed = async () => [item(1, "Ube Halaya"), item(9, "New Jam")];

  it("reads only that Size's quantity and returns its row", async () => {
    const asked: number[][] = [];
    const result = await loadStockSize(() => db.sql, 9, async (ids) => { asked.push(ids); return new Map([[9, { sizeId: 9, quantity: 5, reserved: 1, available: 4 }]]); }, feed);
    expect(asked).toEqual([[9]]);
    expect(result).toMatchObject({ ok: true, row: { sizeId: 9, product: "New Jam", available: 5, shows: { left: 5 } } });
  });

  it("returns a null row when the IMS no longer lists the Size, and fails without the feed", async () => {
    expect(await loadStockSize(() => db.sql, 77, ims([]), feed)).toEqual({ ok: true, row: null });
    expect(await loadStockSize(() => db.sql, 1, ims([]), async () => null)).toEqual({ ok: false });
  });

  it("merges a refetched Size into the page: replace, insert in order, drop, and recount", () => {
    const mk = (sizeId: number, product: string, available: number) => ({ sizeId, product, imsName: product, size: "", image: null, hasShopImage: true, price: 100, description: "", marker: null, inStock: available, reserved: 0, available, shows: shopShows(available), orders: [] });
    const base = { hasStock: true, rows: [mk(1, "A", 20), mk(3, "C", 20)], summary: summarize([mk(1, "A", 20), mk(3, "C", 20)]) };
    const inserted = withSize(base, 2, mk(2, "B", 0));
    expect(inserted.rows.map((r) => r.sizeId)).toEqual([1, 2, 3]);
    expect(inserted.summary.soldOut).toBe(1);
    const replaced = withSize(inserted, 2, mk(2, "B", 5));
    expect(replaced.summary).toMatchObject({ soldOut: 0, low: 1 });
    expect(withSize(replaced, 3, null).rows.map((r) => r.sizeId)).toEqual([1, 2]);
  });
});

describe("Products & stock with a local copy of the IMS", () => {
  const stockOf = (rows: [number, number][]): Map<number, ImsSizeStock> =>
    new Map(rows.map(([id, qty]) => [id, { sizeId: id, quantity: qty, reserved: 0, available: qty }]));
  const memory = (initial: { feed: ImsProduct[]; stock: Map<number, ImsSizeStock>; syncedAt: Date } | null) => {
    const state = { mirror: initial, saved: 0, savedOne: 0, deleted: 0, failWrites: false };
    return {
      state,
      load: async () => state.mirror,
      save: async (feed: ImsProduct[], stock: Map<number, ImsSizeStock>) => {
        if (state.failWrites) throw new Error("mirror down");
        state.saved++;
        state.mirror = { feed, stock, syncedAt: new Date() };
      },
      saveOne: async () => { if (state.failWrites) throw new Error("mirror down"); state.savedOne++; },
      deleteOne: async () => { state.deleted++; },
    };
  };
  const live = async () => (await feedOfSeed());
  const none = async () => null;
  const noContent = async () => new Map();
  const asOf = new Date("2026-11-20T08:00:00Z");

  it("writes what the IMS said to the copy", async () => {
    const mirror = memory(null);
    const result = await loadStock(() => db.sql, async () => stockOf([[101, 12]]), live, noContent, mirror);
    expect(result.ok && result.page.hasStock).toBe(true);
    expect(mirror.state.saved).toBe(1);
  });

  it("opens on the copy without asking the IMS: name, image, price, stock and CREOMS's own reserved", async () => {
    const feed = await feedOfSeed();
    const mirror = memory({ feed, stock: new Map([[101, { sizeId: 101, quantity: 12, reserved: 99, available: 1 }]]), syncedAt: asOf });
    await db.sql`insert into stock_reservations values ('r1', 7, 'placed', ${db.sql.json([{ orderLineId: 1, sizeId: 1, quantity: 4 }] as never)})`;
    const result = await loadStockCopy(() => db.sql, priced({ 101: { price: 250 } }), mirror);
    if (!result.ok) throw new Error("expected a page");
    expect(result.page.hasStock).toBe(true);
    expect(result.page.rows.find((r) => r.sizeId === 101)).toMatchObject({
      product: "Ube Halaya Smooth", image: "img", price: 250, inStock: 12, reserved: 4, available: 8,
    });
    expect(mirror.state.saved).toBe(0);
  });

  it("opens with nothing, and says so, when CREOMS has no copy yet or cannot read it", async () => {
    for (const mirror of [memory(null), { ...memory(null), load: async () => { throw new Error("no table"); } }]) {
      const result = await loadStockCopy(() => db.sql, noContent, mirror);
      expect(result.ok && result.page).toMatchObject({ rows: [], hasStock: false });
    }
  });

  it("falls back to the copy, silently, when the IMS feed cannot be read", async () => {
    const feed = await feedOfSeed();
    const mirror = memory({ feed, stock: stockOf([[101, 12], [102, 0], [103, 50]]), syncedAt: asOf });
    const result = await loadStock(() => db.sql, async () => null, none, noContent, mirror);
    if (!result.ok) throw new Error("expected a page");
    expect(result.page).not.toHaveProperty("stale");
    expect(result.page.rows.find((r) => r.sizeId === 101)?.inStock).toBe(12);
    expect(result.page.rows.find((r) => r.sizeId === 102)?.shows).toBe("Sold out");
  });

  it("uses the copy's quantities when the feed answers but the stock read does not", async () => {
    const feed = await feedOfSeed();
    const mirror = memory({ feed, stock: stockOf([[101, 12], [102, 3], [103, 50]]), syncedAt: asOf });
    const result = await loadStock(() => db.sql, async () => null, live, noContent, mirror);
    if (!result.ok) throw new Error("expected a page");
    expect(result.page.rows.find((r) => r.sizeId === 101)?.inStock).toBe(12);
    expect(mirror.state.saved).toBe(0);
  });

  it("still shows live rows when writing the copy fails", async () => {
    const mirror = memory(null);
    mirror.state.failWrites = true;
    const result = await loadStock(() => db.sql, async () => stockOf([[101, 12]]), live, noContent, mirror);
    expect(result.ok && result.page.rows.length).toBe(3);
  });

  it("has nothing to show when the IMS is down and the copy is empty or unreadable", async () => {
    for (const mirror of [memory(null), { ...memory(null), load: async () => { throw new Error("no table"); } }]) {
      const result = await loadStock(() => db.sql, async () => null, none, noContent, mirror);
      expect(result.ok && result.page).toMatchObject({ rows: [], hasStock: false });
    }
  });

  it("writes a refetched Size through to the copy", async () => {
    const mirror = memory(null);
    await loadStockSize(() => db.sql, 101, async () => stockOf([[101, 7]]), live, noContent, mirror);
    expect(mirror.state.savedOne).toBe(1);
  });

  it("forgets a Size in the copy once the IMS no longer lists it", async () => {
    const mirror = memory(null);
    expect(await loadStockSize(() => db.sql, 777, async () => stockOf([]), live, noContent, mirror)).toEqual({ ok: true, row: null });
    expect(mirror.state.deleted).toBe(1);
    expect(mirror.state.savedOne).toBe(0);
  });
});
