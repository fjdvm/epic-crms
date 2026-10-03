import { describe, expect, it } from "vitest";

import { isCustomer, totalSpent } from "./rules";

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
