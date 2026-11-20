import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadProductContent, saveProductContent } from "@/features/orders/product-content";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const staff = { id: "s1", name: "Sam", role: "Staff/Employee" };

describe("saveProductContent", () => {
  let db: TestDatabase;
  const audit = vi.fn(async () => {});
  beforeAll(async () => {
    db = await startTestDatabase();
    await db.sql`create schema crms`;
    await db.sql.unsafe(readFileSync("docs/db/crms-product-content.sql", "utf8"));
  }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    audit.mockClear();
    await db.sql`delete from crms.product_content`;
  });

  it.each(["Super Admin", "CEO"])("refuses %s on the server and writes nothing", async (role) => {
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
    expect((await loadProductContent(db.sql)).get(7)).toEqual({ description: "Ube jam, 250 g.", imageUrl: image.url });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.mock.calls[0])).toContain("Sam");
  });

  it("keeps the saved image when the edit leaves it unchanged, and replaces it when a new one is given", async () => {
    await saveProductContent(db.sql, audit, staff, { productId: 7, description: "A", image: { fileId: "f1", url: "https://files.example/f1.png" } });
    await saveProductContent(db.sql, audit, staff, { productId: 7, description: "B", image: undefined });
    expect((await loadProductContent(db.sql)).get(7)).toEqual({ description: "B", imageUrl: "https://files.example/f1.png" });
    await saveProductContent(db.sql, audit, staff, { productId: 7, description: "B", image: { fileId: "f2", url: "https://files.example/f2.png" } });
    expect((await loadProductContent(db.sql)).get(7)?.imageUrl).toBe("https://files.example/f2.png");
  });
});
