import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { areaInsightsIn } from "@/features/ai-insights/areas";
import { resolvePeriod } from "@/features/dashboard/period";
import { addressArea, areaKey, areaName, METRO_MANILA } from "@/lib/geo/areas";
import map from "@/lib/geo/ph-provinces.json";
import provinces from "@/lib/psgc/data/provinces.json";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

describe("map areas", () => {
  it("has a shape for every Province of the address picker, and for Metro Manila", () => {
    const shapes = new Set(map.shapes.map((s) => s.key));
    for (const [, name] of provinces as string[][]) expect(shapes, name).toContain(areaKey(name));
    expect(shapes).toContain(METRO_MANILA);
  });

  it("places an address by its Province, ignoring case and accents", () => {
    expect(addressArea("Cavite", "City of Bacoor")).toBe("cavite");
    expect(addressArea("  lanao del sur ", "Marawi")).toBe("lanao del sur");
    expect(addressArea("Maguindanao del Norte", "Datu Odin Sinsuat")).toBe("maguindanao");
    expect(areaName("cavite")).toBe("Cavite");
  });

  it("places an address with no Province by its city, and gives up on unknown names", () => {
    expect(addressArea("", "Quezon City")).toBe(METRO_MANILA);
    expect(addressArea("", "City of Las Piñas")).toBe(METRO_MANILA);
    expect(addressArea("", "City of Isabela")).toBe("basilan");
    expect(addressArea("", "City of Cebu")).toBeNull();
    expect(addressArea("Atlantis", "Somewhere")).toBeNull();
    expect(areaName(METRO_MANILA)).toBe("Metro Manila");
  });
});

let db: TestDatabase;
const now = new Date("2026-10-25T07:00:00Z");
const period = resolvePeriod("7-days", now);

beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate failed_deliveries, order_returns, order_delivery_addresses, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria', 'maria@example.com')`;
});

async function order({ at = "2026-10-24T02:00:00Z", status = "paid", subtotal = 10000, payment = "gcash",
  province = "Cavite", city = "City of Bacoor", address = true } = {}) {
  const [row] = await db.sql<{ id: number }[]>`insert into orders (customer_id, created_at, status, subtotal_in_centavos, payment_method)
    values ('c1', ${new Date(at)}, ${status}, ${subtotal}, ${payment}) returning id`;
  if (address) {
    await db.sql`insert into order_delivery_addresses (order_id, street, barangay, city, province, postal_code)
      values (${row.id}, '1 Main St', 'Molino', ${city}, ${province}, '4102')`;
  }
  return row.id;
}

describe("areaInsightsIn", () => {
  it("adds up Orders counted in Sales by Province and city, with the period before for comparison", async () => {
    await order({ subtotal: 10000 });
    await order({ subtotal: 30000, city: "City of Imus", payment: "cash-on-delivery" });
    const failed = await order({ subtotal: 20000 });
    await db.sql`insert into failed_deliveries (id, order_id, reason, next_step, customer_message, staff_id, staff_name)
      values ('f1', ${failed}, 'Not home', 'rebook', 'Sorry', 's1', 'Ana')`;
    const returned = await order({ subtotal: 5000, province: "", city: "Quezon City" });
    await db.sql`insert into order_returns (order_id, status, reason, amount_in_centavos) values (${returned}, 'refunded', 'damaged', 2000)`;
    await order({ at: "2026-10-15T02:00:00Z" }); // the period before
    await order({ status: "placed" }); // not counted in Sales
    await order({ address: false }); // pickup
    await order({ province: "Atlantis", city: "Nowhere", subtotal: 7000 });
    await order({ at: "2026-10-01T02:00:00Z" }); // too old for either period

    const { areas, unmapped } = await areaInsightsIn(db.sql, period);

    expect(areas.map((a) => a.key)).toEqual(["cavite", METRO_MANILA]);
    expect(areas[0]).toMatchObject({
      name: "Cavite", orders: 3, sales: 60000, cod: 1, failed: 1, returned: 0, previousOrders: 1,
      cities: [{ name: "City of Bacoor", orders: 2, sales: 30000 }, { name: "City of Imus", orders: 1, sales: 30000 }],
    });
    expect(areas[1]).toMatchObject({ name: "Metro Manila", orders: 1, sales: 3000, returned: 1, previousOrders: 0 });
    expect(unmapped).toEqual({ orders: 1, sales: 7000 });
  });

  it("leaves out Replacement Orders", async () => {
    const original = await order();
    await db.sql`update orders set replacement_for_order_id = ${original} where id = ${await order()}`;
    const { areas } = await areaInsightsIn(db.sql, period);
    expect(areas[0].orders).toBe(1);
  });
});
