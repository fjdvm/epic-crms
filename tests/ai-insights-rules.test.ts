import { describe, expect, it } from "vitest";

import { periodSpan } from "@/features/ai-insights/facts";
import {
  buildInsights, buildStats, confidenceFor, MIN_ORDERS, worsened, type AreaFigures, type CityFigures, type InsightFacts,
} from "@/features/ai-insights/insights";
import { visibleInsights } from "@/features/ai-insights/store";
import { updatedLabel, visibleStats } from "@/features/ai-insights/view-model";
import { cityKey, cityLabel } from "@/lib/geo/areas";
import cities from "@/lib/geo/ph-cities.json";

const city = (over: Partial<CityFigures> = {}): CityFigures => ({
  key: "metro manila|pasig", name: "Pasig", province: "metro manila", orders: 10, previousOrders: 8, wentOut: 8, lateOrFailed: 0,
  previousWentOut: 8, previousLateOrFailed: 0, returned: 0, complaints: 0, deliveries: 9, freeDelivery: 3, ...over,
});
const area = (cs: CityFigures[]): AreaFigures => ({
  ...city({ key: "metro manila", name: "Metro Manila" }), cities: cs,
});

function facts(over: Partial<InsightFacts> = {}): InsightFacts {
  return {
    days: 7, orders: 40, previousOrders: 32, wentOut: 30, lateOrFailed: 2, returnsRequested: 1, returnedOrders: 1,
    areas: [], unmapped: 0, lateOrFailedByCity: [], couriers: [], stock: [], expiring: { orders: 0, value: 0, orderIds: [], soonestHours: null },
    sla: { atRisk: 0, breaching: 0, ticketIds: [], open: 4 }, returns: { sold: 100, returned: 2, products: [] }, themes: [], ...over,
  };
}

describe("not enough data", () => {
  it("makes no insights and shows dashes below about 30 Orders, whatever else is true", () => {
    const thin = facts({
      orders: MIN_ORDERS - 1,
      expiring: { orders: 5, value: 100000, orderIds: [1, 2, 3, 4, 5], soonestHours: 2 },
      stock: [{ key: "1", name: "Ube halaya 12 oz", available: 2, soldPerDay: 3, daysLeft: 0, unitsSold: 42, orderIds: [9] }],
    });
    expect(buildInsights(thin)).toEqual([]);
    const stats = buildStats(thin);
    expect(Object.values(stats).every((s) => s.value === null && s.note === "No data yet")).toBe(true);
  });
});

describe("the rules", () => {
  it("warns about a Size that runs out soon, with its Orders as evidence and confidence from units sold", () => {
    const [card] = buildInsights(facts({
      stock: [{ key: "12", name: "Ube halaya 12 oz", available: 9, soldPerDay: 2.1, daysLeft: 4, unitsSold: 29, orderIds: [44, 43] }],
    }));
    expect(card).toMatchObject({
      key: "stock:12", category: "stock", priority: "watch", confidence: "medium", headline: "Ube halaya 12 oz may run out in about 4 days",
      records: [{ type: "order", id: 44 }, { type: "order", id: 43 }], action: { href: "/orders/stock" }, numbers: { daysShort: 1 },
    });
    expect(card.basedOn).toBe("9 left, selling about 2.1 a day over the last 14 days");
  });

  it("lists unpaid Orders that will auto-cancel within 24 hours, with each Order linked", () => {
    const [card] = buildInsights(facts({ expiring: { orders: 5, value: 412000, orderIds: [7, 8, 9, 10, 11], soonestHours: 3 } }));
    expect(card).toMatchObject({ key: "payments:expiring", priority: "high", confidence: "high", action: { label: "Open Payments" } });
    expect(card.headline).toBe("5 unpaid Orders will auto-cancel within 24 hours");
    expect(card.basedOn).toContain("₱4,120");
    expect(card.records).toHaveLength(5);
  });

  it("groups repeated Ticket themes by product and area, never above Medium confidence", () => {
    const [card] = buildInsights(facts({
      themes: [{ label: "Leaking lids", ticketIds: [6, 5, 4, 3, 2, 1], product: "Ube halaya 12 oz", productTickets: 4, area: "Pasig", areaTickets: 3 }],
    }));
    expect(card).toMatchObject({ category: "support", confidence: "low", priority: "high" });
    expect(card.headline).toBe("6 Tickets this week mention leaking lids");
    expect(card.basedOn).toBe("6 Tickets: 4 about Ube halaya 12 oz, 3 from Pasig");
    expect(confidenceFor(40, "medium").confidence).toBe("medium");
    expect(buildInsights(facts({ themes: [{ label: "Late", ticketIds: [1, 2], product: null, productTickets: 0, area: null, areaTickets: 0 }] }))).toEqual([]);
  });

  it("flags Tickets that may miss the first-reply target", () => {
    const [card] = buildInsights(facts({ sla: { atRisk: 3, breaching: 1, ticketIds: [12, 10, 11], open: 9 } }));
    expect(card).toMatchObject({ key: "support:sla", priority: "high", records: [{ type: "ticket", id: 12 }, { type: "ticket", id: 10 }, { type: "ticket", id: 11 }] });
    expect(card.basedOn).toContain("the clock stops while On hold");
  });

  it("flags a product returned at well above the shop average, and not one near it", () => {
    const returns = { sold: 200, returned: 8, products: [
      { product: "Halaya strawberry", sold: 20, returned: 4, returnIds: [31, 30] },
      { product: "Ube jam", sold: 100, returned: 4, returnIds: [29] },
    ] };
    const cards = buildInsights(facts({ returns }));
    expect(cards.map((c) => c.key)).toEqual(["returns:halaya-strawberry"]);
    expect(cards[0].headline).toBe("Halaya strawberry has a high return rate: 20%");
    expect(cards[0].basedOn).toBe("4 of 20 sold came back; the shop average is 4%");
    expect(cards[0].priority).toBe("high");
  });

  it("flags cities and couriers whose late or failed deliveries rose, using only the late or failed Orders as evidence", () => {
    const taytay = city({ key: "rizal|taytay", name: "Taytay", province: "rizal", wentOut: 6, lateOrFailed: 3, previousWentOut: 6, previousLateOrFailed: 0 });
    const steady = city({ wentOut: 10, lateOrFailed: 2, previousWentOut: 10, previousLateOrFailed: 2 });
    const cards = buildInsights(facts({
      areas: [area([taytay, steady])], lateOrFailedByCity: [{ key: "rizal|taytay", orderIds: [91, 90, 89] }],
      couriers: [
        { courier: "Lalamove", wentOut: 10, lateOrFailed: 3, previousWentOut: 10, previousLateOrFailed: 1, orderIds: [91, 90, 88] },
        { courier: "Grab", wentOut: 3, lateOrFailed: 3, previousWentOut: 0, previousLateOrFailed: 0, orderIds: [1] },
      ],
    }));
    const delivery = cards.filter((c) => c.category === "delivery");
    expect(delivery.map((c) => c.key)).toEqual(["delivery:areas:rizal-taytay", "delivery:courier:lalamove"]);
    expect(delivery[0].headline).toBe("Late and failed deliveries are up in Taytay");
    expect(delivery[0].basedOn).toBe("3 of 6 deliveries late or failed (50%), against 0% the week before");
    expect(delivery[0].records.map((r) => r.id)).toEqual([91, 90, 89]);
  });

  it("puts High priority first", () => {
    const cards = buildInsights(facts({
      sla: { atRisk: 1, breaching: 0, ticketIds: [1], open: 3 },
      expiring: { orders: 4, value: 1, orderIds: [1, 2, 3, 4], soonestHours: 1 },
    }));
    expect(cards.map((c) => c.priority)).toEqual(["high", "watch"]);
  });
});

describe("confidence", () => {
  it("is Low on a small sample, Medium on a moderate one, High on a large one", () => {
    expect(confidenceFor(4)).toMatchObject({ confidence: "low", reason: expect.stringContaining("only 4") });
    expect(confidenceFor(12).confidence).toBe("medium");
    expect(confidenceFor(30).confidence).toBe("high");
  });
});

describe("stats", () => {
  it("compares Orders with the period before and notes Tickets near their target", () => {
    const stats = buildStats(facts({ sla: { atRisk: 2, breaching: 0, ticketIds: [1, 2], open: 11 } }));
    expect(stats.orders).toEqual({ value: 40, note: "+25% vs the week before", tone: "up" });
    expect(stats.openTickets).toMatchObject({ value: 11, note: "2 near the 24h target" });
    expect(stats.lateOrFailed.note).toBe("7% of 30 deliveries");
  });

  it("dashes the tiles from Modules the person does not hold", () => {
    const stats = visibleStats(buildStats(facts()), ["Orders"]);
    expect(stats.orders.value).toBe(40);
    expect(stats.openTickets).toEqual({ value: null, note: "Not in your Modules" });
  });
});

describe("per person", () => {
  const cards = buildInsights(facts({
    expiring: { orders: 2, value: 1, orderIds: [1, 2], soonestHours: 1 },
    sla: { atRisk: 1, breaching: 0, ticketIds: [1], open: 3 },
  }));

  it("shows only cards from held Modules, and hides dismissed ones until their numbers get worse", () => {
    expect(visibleInsights(cards, ["Payments"], new Map()).map((c) => c.key)).toEqual(["payments:expiring"]);
    const dismissed = new Map([["payments:expiring", { orders: 2 }]]);
    expect(visibleInsights(cards, ["Payments", "Tickets"], dismissed).map((c) => c.key)).toEqual(["support:sla"]);
    expect(visibleInsights(cards, ["Payments"], new Map([["payments:expiring", { orders: 1 }]]))).toHaveLength(1);
    expect(worsened({ orders: 2 }, { orders: 3 })).toBe(false);
  });
});

describe("periods and labels", () => {
  it("covers whole Philippine days before today, and the same length before that", () => {
    const span = periodSpan(7, new Date("2026-11-24T22:00:00Z")); // 6:00 am, 25 Nov in Manila
    expect(span.end.toISOString()).toBe("2026-11-24T16:00:00.000Z");
    expect(span.start.toISOString()).toBe("2026-11-17T16:00:00.000Z");
    expect(span.previous.start.toISOString()).toBe("2026-11-10T16:00:00.000Z");
  });

  it("says when the run was made, in Philippine time", () => {
    const run = "2026-11-24T22:00:00Z";
    expect(updatedLabel(run, new Date("2026-11-25T03:00:00Z"))).toBe("Updated today, 6:00 am");
    expect(updatedLabel(run, new Date("2026-11-25T17:00:00Z"))).toBe("Updated yesterday, 6:00 am");
  });

  it("places a delivery city on the zoomed map by its name", () => {
    const keys = new Set(cities.cities.map((c) => `${c.province}|${c.key}`));
    for (const name of ["City of Makati", "Quezon City", "Pasay City", "City of Las Piñas", "Pateros"]) expect(keys).toContain(`metro manila|${cityKey(name)}`);
    expect(keys).toContain(`rizal|${cityKey("Taytay")}`);
    expect(cityLabel("City of Makati")).toBe("Makati");
  });
});
