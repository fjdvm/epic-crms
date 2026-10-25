// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  BestSellersCard, BestSellersSkeleton, BuyersCard, BuyersSkeleton, PaymentCard, PaymentSkeleton,
} from "@/features/dashboard/breakdown-cards";
import { bestSellersHeadline, buyersHeadline, paymentHeadline } from "@/features/dashboard/breakdown-headlines";

afterEach(cleanup);

const product = (productName: string, sales: number, units: number, share: number | null) => ({
  productName, sales, units, share,
});
const pesos = (centavos: number) => `₱${(centavos / 100).toLocaleString("en-PH")}`;

describe("the breakdown headlines", () => {
  it("names the product leading Sales", () => {
    expect(bestSellersHeadline([product("Ube Halaya", 60_000, 6, 0.6)])).toBe("Ube Halaya leads with 60% of Sales");
  });

  it("falls back to a neutral title with no share to quote", () => {
    expect(bestSellersHeadline([])).toBe("Best-selling products");
    expect(bestSellersHeadline([product("Ube Halaya", 0, 1, null)])).toBe("Best-selling products");
  });

  it("says Returning Buyers grew every month only when finished months show it", () => {
    const month = (label: string, returning: number, soFar = false) => ({ label, soFar, new: 1, returning, share: null });
    const rising = [month("2026-05", 1), month("2026-06", 1), month("2026-07", 2), month("2026-08", 3), month("2026-09", 4), month("2026-10", 0, true)];
    expect(buyersHeadline(rising)).toBe("Returning Buyers have grown every month since June");
    expect(buyersHeadline([month("2026-08", 3), month("2026-09", 2), month("2026-10", 0, true)])).toBe("New vs returning Buyers");
  });

  it("names the payment method most Orders use, else stays neutral", () => {
    const pay = (method: string, orders: number) => ({ method, orders, sales: 0 });
    expect(paymentHeadline([pay("gcash", 3), pay("cash-on-delivery", 1)])).toBe("Most Orders are paid by GCash");
    expect(paymentHeadline([pay("gcash", 1), pay("cash-on-delivery", 3)])).toBe("Most Orders are Cash on Delivery");
    expect(paymentHeadline([pay("gcash", 2), pay("cash-on-delivery", 2)])).toBe("How customers pay");
    expect(paymentHeadline([])).toBe("How customers pay");
  });
});

describe("the Best sellers card", () => {
  it("shows each product with its share and units sold", () => {
    render(
      <BestSellersCard
        widget={{ ok: true, products: [product("Ube Halaya", 60_000, 6, 0.6), product("Leche Flan", 30_000, 3, 0.3)], remainder: { sales: 10_000, share: 0.1 } }}
        format={pesos}
      />,
    );

    expect(screen.getByText("Ube Halaya")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText("6 sold · ₱600")).toBeTruthy();
    expect(screen.getByText("Leche Flan")).toBeTruthy();
    expect(screen.getByText("Other products and Delivery fees")).toBeTruthy();
    expect(screen.getByText("10%")).toBeTruthy();
  });

  it("says there are no Orders in an empty period", () => {
    render(<BestSellersCard widget={{ ok: true, products: [], remainder: { sales: 0, share: null } }} format={pesos} />);

    expect(screen.getByText("No Orders in this period")).toBeTruthy();
  });

  it("shows Couldn't load in its own card", () => {
    render(<BestSellersCard widget={{ ok: false }} format={pesos} />);

    expect(screen.getByText("Couldn't load")).toBeTruthy();
  });

  it("has its own skeleton", () => {
    render(<BestSellersSkeleton />);
    expect(screen.getByRole("status", { name: "Loading Best sellers" })).toBeTruthy();
  });
});

describe("the New vs returning Buyers card", () => {
  const months = [
    { label: "2026-09", soFar: false, new: 3, returning: 1, share: 0.25 },
    { label: "2026-10", soFar: true, new: 0, returning: 0, share: null },
  ];

  it("shows the monthly split and the returning share", () => {
    render(<BuyersCard widget={{ ok: true, months }} />);

    expect(screen.getByText("Sep")).toBeTruthy();
    expect(screen.getByText("3 new · 1 returning")).toBeTruthy();
    expect(screen.getByText("25% returning")).toBeTruthy();
  });

  it("says there are no Orders when there are no Buyers", () => {
    render(<BuyersCard widget={{ ok: true, months: [] }} />);
    expect(screen.getByText("No Orders in this period")).toBeTruthy();
  });

  it("shows Couldn't load in its own card", () => {
    render(<BuyersCard widget={{ ok: false }} />);
    expect(screen.getByText("Couldn't load")).toBeTruthy();
  });

  it("has its own skeleton", () => {
    render(<BuyersSkeleton />);
    expect(screen.getByRole("status", { name: "Loading New vs returning Buyers" })).toBeTruthy();
  });
});

describe("the How customers pay card", () => {
  it("shows GCash vs Cash on Delivery and Pickup vs Delivery, and never Maya or Bank transfer", () => {
    render(
      <PaymentCard
        widget={{
          ok: true,
          payment: [{ method: "cash-on-delivery", orders: 1, sales: 100 }, { method: "gcash", orders: 3, sales: 300 }, { method: "maya", orders: 2, sales: 200 }],
          receiving: [{ method: "pickup", orders: 4, sales: 400 }],
        }}
      />,
    );

    expect(screen.getByText("GCash")).toBeTruthy();
    expect(screen.getByText("Cash on Delivery")).toBeTruthy();
    expect(screen.getByText("Pickup")).toBeTruthy();
    expect(screen.getByText("Delivery")).toBeTruthy();
    expect(screen.getByText("3 Orders")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.queryByText(/Maya|Bank transfer/)).toBeNull();
  });

  it("says there are no Orders in an empty period", () => {
    render(<PaymentCard widget={{ ok: true, payment: [], receiving: [] }} />);
    expect(screen.getByText("No Orders in this period")).toBeTruthy();
  });

  it("shows Couldn't load in its own card", () => {
    render(<PaymentCard widget={{ ok: false }} />);
    expect(screen.getByText("Couldn't load")).toBeTruthy();
  });

  it("has its own skeleton", () => {
    render(<PaymentSkeleton />);
    expect(screen.getByRole("status", { name: "Loading How customers pay" })).toBeTruthy();
  });
});
