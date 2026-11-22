import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadMirror, saveMirror, saveMirrorOne } from "@/features/orders/stock-mirror";
import type { ImsProduct, ImsSizeStock } from "@/lib/storefront";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const item = (productId: number, over: Partial<ImsProduct> = {}): ImsProduct =>
  ({ productId, name: `Product ${productId}`, variant: "250g", image: "img", price: 120, active: true, ...over });
const held = (sizeId: number, quantity: number | null, reserved: number | null = 0): ImsSizeStock =>
  ({ sizeId, quantity, reserved, available: quantity === null || reserved === null ? null : quantity - reserved });

describe("stock mirror", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await startTestDatabase();
    await db.sql`create schema crms`;
    await db.sql.unsafe(readFileSync("docs/db/crms-stock-mirror.sql", "utf8"));
  }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => { await db.sql`delete from crms.stock_mirror`; });

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
});
