import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyProductPrice, loadProductContent, saveProductContent } from "@/features/orders/product-content";
import { parsePrice } from "@/features/orders/product-content-limits";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const staff = { id: "s1", name: "Sam", role: "Staff/Employee" };
const IMG = { fileId: "f0", url: "https://files.example/f0.png" };

describe("saveProductContent", () => {
  let db: TestDatabase;
  const audit = vi.fn(async () => {});
  beforeAll(async () => {
    db = await startTestDatabase();
    await db.sql`create schema crms`;
    await db.sql.unsafe(readFileSync("docs/db/crms-product-content.sql", "utf8"));
    await db.sql.unsafe(readFileSync("docs/db/crms-product-content-name-price.sql", "utf8"));
    // Safe to re-run.
    await db.sql.unsafe(readFileSync("docs/db/crms-product-content-name-price.sql", "utf8"));
  }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    audit.mockClear();
    await db.sql`delete from crms.product_content`;
  });

  it.each(["Super Admin"])("refuses %s on the server and writes nothing", async (role) => {
    const result = await saveProductContent(db.sql, audit, { ...staff, role }, { productId: 7, description: "Hi", image: null });
    expect(result).toEqual({ ok: false, reason: "Your Role can only view shop work." });
    expect((await loadProductContent(db.sql)).size).toBe(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses product id %s", async (productId) => {
    const result = await saveProductContent(db.sql, audit, staff, { productId, description: "Hi", image: null });
    expect(result.ok).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses a description over 2000 characters", async () => {
    const result = await saveProductContent(db.sql, audit, staff, { productId: 7, description: "x".repeat(2001), image: null });
    expect(result).toEqual({ ok: false, reason: "The description is at most 2000 characters." });
    expect((await loadProductContent(db.sql)).size).toBe(0);
  });

  it("saves the trimmed description and image, then audits under the person's name", async () => {
    const image = { fileId: "f1", url: "https://files.example/f1.png" };
    const result = await saveProductContent(db.sql, audit, staff, { productId: 7, description: "  Ube jam, 250 g.  ", image });
    expect(result).toEqual({ ok: true });
    expect((await loadProductContent(db.sql)).get(7)).toEqual({ description: "Ube jam, 250 g.", imageUrl: image.url, name: null, price: null });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.mock.calls[0])).toContain("Sam");
  });

  it("refuses to publish a product that has no image yet, and accepts a saved or a new one", async () => {
    const refused = await saveProductContent(db.sql, audit, staff, { productId: 7, description: "Hi", image: null, name: "Ube Jam" });
    expect(refused).toEqual({ ok: false, reason: "Add an image before publishing. The shop shows a product only once it has one." });
    expect((await loadProductContent(db.sql)).size).toBe(0);
    expect(audit).not.toHaveBeenCalled();
    // A price set first (a Manager decision) still leaves the product without an image.
    await applyProductPrice(db.sql, audit, { id: "m1", name: "Mia", role: "CREOMS Manager" }, { productId: 8, price: 100 });
    expect((await saveProductContent(db.sql, audit, staff, { productId: 8, description: "Hi" })).ok).toBe(false);
    expect(await saveProductContent(db.sql, audit, staff, { productId: 8, description: "Hi", image: IMG })).toEqual({ ok: true });
    expect(await saveProductContent(db.sql, audit, staff, { productId: 8, description: "Again" })).toEqual({ ok: true });
  });

  it("reads only the asked-for products", async () => {
    await saveProductContent(db.sql, audit, staff, { productId: 7, description: "A", image: IMG });
    await saveProductContent(db.sql, audit, staff, { productId: 8, description: "B", image: IMG });
    expect([...(await loadProductContent(db.sql, [8, 99])).keys()]).toEqual([8]);
  });

  it("keeps the saved image when the edit leaves it unchanged, and replaces it when a new one is given", async () => {
    await saveProductContent(db.sql, audit, staff, { productId: 7, description: "A", image: { fileId: "f1", url: "https://files.example/f1.png" } });
    await saveProductContent(db.sql, audit, staff, { productId: 7, description: "B", image: undefined });
    expect((await loadProductContent(db.sql)).get(7)).toEqual({ description: "B", imageUrl: "https://files.example/f1.png", name: null, price: null });
    await saveProductContent(db.sql, audit, staff, { productId: 7, description: "B", image: { fileId: "f2", url: "https://files.example/f2.png" } });
    expect((await loadProductContent(db.sql)).get(7)?.imageUrl).toBe("https://files.example/f2.png");
  });

  it("keeps CREOMS's own shop name: undefined keeps it, empty goes back to the IMS name", async () => {
    await saveProductContent(db.sql, audit, staff, { productId: 7, description: "A", name: "  Ube   Jam Extreme ", image: IMG });
    expect((await loadProductContent(db.sql)).get(7)?.name).toBe("Ube Jam Extreme");
    await saveProductContent(db.sql, audit, staff, { productId: 7, description: "B" });
    expect((await loadProductContent(db.sql)).get(7)?.name).toBe("Ube Jam Extreme");
    await saveProductContent(db.sql, audit, staff, { productId: 7, description: "B", name: "" });
    expect((await loadProductContent(db.sql)).get(7)?.name).toBeNull();
  });

  it.each([["x".repeat(121), "The name is at most 120 characters."], ["<b>Jam</b>", "Use plain text for the name."]])("refuses the name %s", async (name, reason) => {
    expect(await saveProductContent(db.sql, audit, staff, { productId: 7, description: "A", name })).toEqual({ ok: false, reason });
    expect((await loadProductContent(db.sql)).size).toBe(0);
  });
});

describe("applyProductPrice", () => {
  let db: TestDatabase;
  const audit = vi.fn(async () => {});
  const manager = { id: "m1", name: "Mia", role: "CREOMS Manager" };
  beforeAll(async () => {
    db = await startTestDatabase();
    await db.sql`create schema crms`;
    await db.sql.unsafe(readFileSync("docs/db/crms-product-content.sql", "utf8"));
    await db.sql.unsafe(readFileSync("docs/db/crms-product-content-name-price.sql", "utf8"));
  }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => { audit.mockClear(); await db.sql`delete from crms.product_content`; });

  it("sets the price in CREOMS only, keeps the description, and audits the old and new price under the Manager's name", async () => {
    await saveProductContent(db.sql, audit, staff, { productId: 7, description: "Sweet.", image: IMG });
    expect(await applyProductPrice(db.sql, audit, manager, { productId: 7, price: 250 })).toEqual({ ok: true });
    expect(await applyProductPrice(db.sql, audit, manager, { productId: 7, price: 275.5 })).toEqual({ ok: true });
    expect((await loadProductContent(db.sql)).get(7)).toEqual({ description: "Sweet.", imageUrl: IMG.url, name: null, price: 275.5 });
    const [row] = await db.sql`select price_updated_by_name from crms.product_content where ims_product_id = 7`;
    expect(row.price_updated_by_name).toBe("Mia");
    const last = JSON.stringify(audit.mock.calls.at(-1));
    expect(last).toContain("product_price.changed");
    expect(last).toContain("Mia");
    expect(last).toContain("was ₱250.00");
  });

  it("sets a price on a product with nothing published yet", async () => {
    expect(await applyProductPrice(db.sql, audit, manager, { productId: 9, price: 99 })).toEqual({ ok: true });
    expect((await loadProductContent(db.sql)).get(9)).toEqual({ description: "", imageUrl: null, name: null, price: 99 });
  });

  it.each([0, -5, 1.234, 1_000_001, Number.NaN])("refuses the price %s and writes nothing", async (price) => {
    expect((await applyProductPrice(db.sql, audit, manager, { productId: 7, price })).ok).toBe(false);
    expect((await loadProductContent(db.sql)).size).toBe(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("reads a typed price with commas, refusing letters and three decimals", () => {
    expect(parsePrice("1,250.50")).toBe(1250.5);
    expect(parsePrice("12")).toBe(12);
    expect(parsePrice("12.345")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("")).toBeNull();
  });
});
