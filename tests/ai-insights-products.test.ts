import { describe, expect, it } from "vitest";

import type { ProductFigures } from "@/features/ai-insights/insights";
import { favouriteByPlace, formatMetric, MIN_RATINGS, productChange, productName, rankProducts } from "@/features/ai-insights/products";

const row = (over: Partial<ProductFigures>): ProductFigures => ({
  scope: "all", place: null, product: "Ube Jam", size: null, units: 0, previousUnits: 0, value: 0, orders: 1, previousOrders: 0,
  ratings: 0, ratingTotal: 0, ...over,
});

const rows: ProductFigures[] = [
  row({ product: "Ube Jam", units: 30, previousUnits: 20, value: 450000, orders: 20, ratings: 4, ratingTotal: 18 }),
  row({ product: "Halaya", units: 12, value: 600000, orders: 25, ratings: 2, ratingTotal: 10 }),
  row({ product: "Polvoron", units: 30, value: 90000, orders: 10, ratings: 3, ratingTotal: 15 }),
  row({ product: "Ube Jam", size: "250 g", units: 25, value: 300000, orders: 18 }),
  row({ product: "Ube Jam", size: "500 g", units: 5, value: 150000, orders: 4 }),
  row({ scope: "city", place: "metro manila|pasig", product: "Halaya", units: 9, orders: 9 }),
  row({ scope: "city", place: "metro manila|pasig", product: "Ube Jam", units: 4, orders: 3, ratings: 3, ratingTotal: 15 }),
  row({ scope: "city", place: "metro manila|quezon", product: "Polvoron", units: 7, orders: 2 }),
  row({ scope: "province", place: "metro manila", product: "Halaya", units: 9, orders: 9 }),
];
const names = (list: ProductFigures[]) => list.map(productName);

describe("Top products", () => {
  it("ranks by units, then by value or Orders, with ties falling to units and then the name", () => {
    expect(names(rankProducts(rows, { scope: "all", bySize: false, metric: "units" }))).toEqual(["Polvoron", "Ube Jam", "Halaya"]);
    expect(names(rankProducts(rows, { scope: "all", bySize: false, metric: "value" }))).toEqual(["Halaya", "Ube Jam", "Polvoron"]);
    expect(names(rankProducts(rows, { scope: "all", bySize: false, metric: "orders" }))).toEqual(["Halaya", "Ube Jam", "Polvoron"]);
  });

  it(`ranks by rating only from ${MIN_RATINGS} rated Orders, and puts the rest last`, () => {
    const ranked = rankProducts(rows, { scope: "all", bySize: false, metric: "rating" });
    expect(names(ranked)).toEqual(["Polvoron", "Ube Jam", "Halaya"]);
    expect(formatMetric(ranked[1], "rating")).toBe("4.5 ★ (4)");
    expect(formatMetric(ranked[2], "rating")).toBe("2 rated");
  });

  it("ranks each size on its own when asked", () => {
    expect(names(rankProducts(rows, { scope: "all", bySize: true, metric: "units" }))).toEqual(["Ube Jam 250 g", "Ube Jam 500 g"]);
  });

  it("shows the change in units or Orders against the period before, and none for value or rating", () => {
    expect(productChange(rows[0], "units")).toEqual({ label: "+50%", up: true });
    expect(productChange(rows[0], "orders")).toEqual({ label: "New", up: true });
    expect(productChange(rows[0], "value")).toBeNull();
    expect(formatMetric(rows[1], "value")).toBe("₱6,000");
  });
});

describe("Favourite product per area", () => {
  it("picks each city's or province's best product by the chosen metric", () => {
    const byUnits = favouriteByPlace(rows, { scope: "city", bySize: false, metric: "units" });
    expect(byUnits.get("metro manila|pasig")?.product).toBe("Halaya");
    expect(byUnits.get("metro manila|quezon")?.product).toBe("Polvoron");
    expect(favouriteByPlace(rows, { scope: "province", bySize: false, metric: "units" }).get("metro manila")?.product).toBe("Halaya");
  });

  it("by rating, leaves out a place where nothing has enough ratings", () => {
    const byRating = favouriteByPlace(rows, { scope: "city", bySize: false, metric: "rating" });
    expect(byRating.get("metro manila|pasig")?.product).toBe("Ube Jam");
    expect(byRating.has("metro manila|quezon")).toBe(false);
  });
});
