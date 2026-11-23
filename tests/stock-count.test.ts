import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyImsFigures, loadMirror, saveMirror, saveMirrorOne, type ImsStockPush } from "@/features/orders/stock-count";
import type { ImsProduct, ImsSizeStock } from "@/lib/storefront";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const item = (productId: number, over: Partial<ImsProduct> = {}): ImsProduct =>
  ({ productId, name: `Product ${productId}`, variant: "250g", image: "img", price: 120, active: true, ...over });
const held = (sizeId: number, quantity: number | null, reserved: number | null = 0): ImsSizeStock =>
  ({ sizeId, quantity, reserved, available: quantity === null || reserved === null ? null : quantity - reserved });

describe("stock count", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await startTestDatabase();
    await db.sql`create schema crms`;
    // Production had the old copy; the migration renames it and keeps its rows.
    await db.sql.unsafe(readFileSync("docs/db/crms-stock-mirror.sql", "utf8"));
    await db.sql`insert into crms.stock_mirror (ims_product_id, name, quantity, reserved, available) values (99, 'Old', 1, 0, 1)`;
    await db.sql.unsafe(readFileSync("docs/db/crms-stock-count.sql", "utf8"));
    await db.sql.unsafe(readFileSync("docs/db/crms-stock-count.sql", "utf8"));
    expect((await db.sql`select name from crms.stock_count where ims_product_id = 99`)[0]?.name).toBe("Old");
    expect((await db.sql`select name from crms.stock_mirror where ims_product_id = 99`)[0]?.name).toBe("Old");
  }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => { await db.sql`delete from crms.stock_count`; });

  it("is empty before the first read", async () => {
    expect(await loadMirror(db.sql)).toBeNull();
  });

  it("round-trips the feed and the stock, with the time of the read", async () => {
    await saveMirror(db.sql, [item(1, { variant: null, price: null, active: false }), item(2)], new Map([[1, held(1, 40, 4)], [2, held(2, 0)]]));
    const mirror = await loadMirror(db.sql);
    expect(mirror?.feed).toEqual([item(1, { variant: null, price: null, active: false }), item(2)]);
    expect(mirror?.stock.get(1)).toEqual(held(1, 40, 4));
    expect(mirror?.stock.get(2)).toEqual(held(2, 0));
    expect(Date.now() - (mirror?.syncedAt.getTime() ?? 0)).toBeLessThan(60_000);
  });

  it("drops a product the IMS no longer lists", async () => {
    await saveMirror(db.sql, [item(1), item(2)], new Map([[1, held(1, 5)], [2, held(2, 5)]]));
    await saveMirror(db.sql, [item(2)], new Map([[2, held(2, 5)]]));
    expect((await loadMirror(db.sql))?.feed.map((p) => p.productId)).toEqual([2]);
  });

  it("keeps the last quantity when the IMS did not answer for a product", async () => {
    await saveMirror(db.sql, [item(1)], new Map([[1, held(1, 40, 4)]]));
    await saveMirror(db.sql, [item(1, { name: "Renamed" })], new Map([[1, held(1, null, null)]]));
    const mirror = await loadMirror(db.sql);
    expect(mirror?.feed[0].name).toBe("Renamed");
    expect(mirror?.stock.get(1)).toEqual(held(1, 40, 4));
  });

  it("updates one product without touching the others", async () => {
    await saveMirror(db.sql, [item(1), item(2)], new Map([[1, held(1, 5)], [2, held(2, 5)]]));
    await saveMirrorOne(db.sql, item(2, { name: "Fresh" }), held(2, 9, 1));
    const mirror = await loadMirror(db.sql);
    expect(mirror?.feed.map((p) => p.name)).toEqual(["Product 1", "Fresh"]);
    expect(mirror?.stock.get(2)).toEqual(held(2, 9, 1));
    expect(mirror?.stock.get(1)).toEqual(held(1, 5));
  });

  const push = (version: bigint, over: Partial<ImsStockPush> = {}): ImsStockPush => ({
    productId: 22, name: "Ube Halaya Smooth", variant: "500g", image: null, price: 399, active: true, quantity: 10, reserved: 3, available: 7, version, ...over,
  });

  it("takes the IMS's figures, and only newer ones, so crossed pushes never go backwards", async () => {
    expect(await applyImsFigures(db.sql, push(BigInt(100)))).toBe(true);
    expect((await loadMirror(db.sql))?.stock.get(22)).toEqual({ sizeId: 22, quantity: 10, reserved: 3, available: 7 });
    expect(await applyImsFigures(db.sql, push(BigInt(300), { reserved: 0, available: 10 }))).toBe(true);
    expect(await applyImsFigures(db.sql, push(BigInt(200), { reserved: 5, available: 5 }))).toBe(false);
    expect(await applyImsFigures(db.sql, push(BigInt(300), { reserved: 5, available: 5 }))).toBe(false);
    expect((await loadMirror(db.sql))?.stock.get(22)).toEqual({ sizeId: 22, quantity: 10, reserved: 0, available: 10 });
  });

  it("keeps the last figures when the IMS could not count them this time", async () => {
    await applyImsFigures(db.sql, push(BigInt(1)));
    await applyImsFigures(db.sql, push(BigInt(2), { quantity: null, reserved: null, available: null, name: "Renamed" }));
    const count = await loadMirror(db.sql);
    expect(count?.feed[0].name).toBe("Renamed");
    expect(count?.stock.get(22)).toEqual({ sizeId: 22, quantity: 10, reserved: 3, available: 7 });
  });
});
