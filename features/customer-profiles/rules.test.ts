import { describe, expect, it } from "vitest";

import { isCustomer, stageCutoffs, stageOf, totalSpent } from "./rules";

const order = (status: string, subtotal: number, fee: number | null) => ({
  status,
  subtotalInCentavos: subtotal,
  deliveryFeeInCentavos: fee,
});

describe("totalSpent", () => {
  it("counts paid, preparing, dispatched and delivered orders", () => {
    const orders = ["paid", "preparing", "dispatched", "delivered"].map((s) =>
      order(s, 1000, 0),
    );
    expect(totalSpent(orders)).toBe(4000);
  });

  it("adds the delivery fee to the subtotal", () => {
    expect(totalSpent([order("delivered", 50000, 15000)])).toBe(65000);
  });

  it("treats a missing delivery fee (pickup) as zero", () => {
    expect(totalSpent([order("paid", 50000, null)])).toBe(50000);
  });

  it("excludes cancelled, placed, confirmed and awaiting payment orders", () => {
    const orders = ["cancelled", "placed", "confirmed", "awaiting payment"].map(
      (s) => order(s, 99999, 100),
    );
    expect(totalSpent(orders)).toBe(0);
  });

  it("is zero with no orders", () => {
    expect(totalSpent([])).toBe(0);
  });
});

describe("isCustomer", () => {
  it("is true only when the auth user's email is verified", () => {
    expect(isCustomer({ emailVerified: true })).toBe(true);
    expect(isCustomer({ emailVerified: false })).toBe(false);
  });

  it("is false when there is no matching auth user", () => {
    expect(isCustomer(null)).toBe(false);
  });
});

describe("stageOf", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  it("is New with no Orders", () => {
    expect(stageOf({ orders: 0, lastOrder: null }, now)).toBe("new");
  });

  it("is First order with one recent Order and Repeat with two or more", () => {
    expect(stageOf({ orders: 1, lastOrder: daysAgo(1) }, now)).toBe("first-order");
    expect(stageOf({ orders: 2, lastOrder: daysAgo(1) }, now)).toBe("repeat");
    expect(stageOf({ orders: 9, lastOrder: daysAgo(1) }, now)).toBe("repeat");
  });

  it.each([
    [59, "repeat"],
    [60, "at-risk"],
    [61, "at-risk"],
    [119, "at-risk"],
    [120, "lost"],
    [121, "lost"],
  ])("with the last Order %i days ago is %s", (days, stage) => {
    expect(stageOf({ orders: 3, lastOrder: daysAgo(days) }, now)).toBe(stage);
  });

  it("lets At risk and Lost take precedence over First order", () => {
    expect(stageOf({ orders: 1, lastOrder: daysAgo(70) }, now)).toBe("at-risk");
    expect(stageOf({ orders: 1, lastOrder: daysAgo(200) }, now)).toBe("lost");
  });
});

describe("stageCutoffs", () => {
  it("is the instant 60 and 120 days before now", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    const { atRiskBefore, lostBefore } = stageCutoffs(now);
    expect(atRiskBefore.toISOString()).toBe("2026-08-21T00:00:00.000Z");
    expect(lostBefore.toISOString()).toBe("2026-06-22T00:00:00.000Z");
  });
});
