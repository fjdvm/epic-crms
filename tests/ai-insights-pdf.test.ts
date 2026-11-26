import { describe, expect, it } from "vitest";

import { emptyStats, type AreaFigures, type ProductFigures } from "@/features/ai-insights/insights";
import { insightsPdf } from "@/features/ai-insights/pdf";
import type { InsightRun } from "@/features/ai-insights/run";

const place = { orders: 40, previousOrders: 30, wentOut: 30, lateOrFailed: 2, previousWentOut: 20, previousLateOrFailed: 1, returned: 1, complaints: 1, deliveries: 30, freeDelivery: 4 };
const areas: AreaFigures[] = [{ key: "metro manila", name: "Metro Manila", ...place, cities: [{ key: "metro manila|pasig", name: "Pasig", province: "metro manila", ...place }] }];
const products: ProductFigures[] = [
  { scope: "all", place: null, product: "Ube Jam", size: null, units: 20, previousUnits: 10, value: 300000, orders: 12, previousOrders: 6, ratings: 3, ratingTotal: 14 },
  { scope: "city", place: "metro manila|pasig", product: "Ube Jam", size: null, units: 9, previousUnits: 0, value: 135000, orders: 5, previousOrders: 0, ratings: 0, ratingTotal: 0 },
];
const run = (over: Partial<InsightRun> = {}): InsightRun => ({
  id: 1, days: 7, createdAt: "2026-11-24T22:00:00Z", periodStart: "2026-11-17T16:00:00Z", periodEnd: "2026-11-24T16:00:00Z",
  enoughData: true, orders: 40, stats: emptyStats(), areas, unmapped: 0, products, insights: [], summary: null, summaryConfidence: null, ...over,
});

describe("AI insights PDF", () => {
  it("draws Top products and favourites, and still draws a run stored before products were counted", async () => {
    const now = new Date("2026-11-25T01:00:00Z");
    for (const pdf of [
      await insightsPdf(run(), [], emptyStats(), now, { products: true, ratings: true }),
      await insightsPdf(run(), [], emptyStats(), now, { products: true, ratings: false }),
      await insightsPdf(run({ products: null }), [], emptyStats(), now, { products: true, ratings: true }),
    ]) expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
