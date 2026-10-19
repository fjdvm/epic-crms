// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrdersTab } from "@/features/customer-profiles/orders-tab";
import type { CustomerOrder } from "@/features/customer-profiles/orders";
import { paymentStatusOf } from "@/features/customer-profiles/rules";

afterEach(cleanup);

const address = {
  label: "Home", street: "1 Old St", barangay: "Poblacion", city: "Makati",
  province: "Metro Manila", postalCode: "1200", country: "Philippines",
};

const order = (over: Partial<CustomerOrder>): CustomerOrder => ({
  id: 1,
  createdAt: new Date("2026-03-01T04:00:00Z"),
  status: "delivered",
  fulfillmentMethod: "delivery",
  paymentMethod: "cash-on-delivery",
  lines: [{ product: "Sourdough", size: "Large", quantity: 2, price: 25000 }],
  subtotal: 50000,
  deliveryFee: 10000,
  total: 60000,
  address,
  feedback: null,
  paymentProof: null,
  ...over,
});

const none = new Set<number>();
const open = new Set([1]);

describe("OrdersTab", () => {
  it("shows the empty state and the Sales hint for a Customer with no Orders", () => {
    render(<OrdersTab orders={[]} expanded={none} onToggle={() => {}} />);

    expect(screen.getByText(/no orders yet/i)).toBeTruthy();
    expect(screen.getByText(/managed in Sales/i)).toBeTruthy();
  });

  it("summarises each Order in a row and opens its details on request", () => {
    const toggle = vi.fn();
    render(<OrdersTab orders={[order({})]} expanded={none} onToggle={toggle} />);

    expect(screen.getByText("Sourdough ×2")).toBeTruthy();
    expect(screen.getByText("₱600.00")).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.queryByText(/1 Old St/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "#1" }));
    expect(toggle).toHaveBeenCalledWith(1);
  });

  it("shows lines, totals, the checkout Address and feedback for an open Order", () => {
    render(
      <OrdersTab orders={[order({ feedback: { rating: 4, comment: "Tasty", createdAt: new Date("2026-03-02T00:00:00Z") } })]} expanded={open} onToggle={() => {}} />,
    );

    expect(screen.getByText("Sourdough")).toBeTruthy();
    expect(screen.getAllByText("₱600.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/1 Old St/)).toBeTruthy();
    expect(screen.getByText("4 / 5")).toBeTruthy();
    expect(screen.getByText("Tasty")).toBeTruthy();
    expect(screen.queryByText(/payment proof/i)).toBeNull();
  });

  it("shows GCash payment proof on the Order that has it", () => {
    render(
      <OrdersTab
        orders={[
          order({
            paymentMethod: "gcash",
            paymentProof: { reference: "REF123", screenshot: "proofs/a.png", submittedAt: null },
          }),
        ]}
        expanded={open}
        onToggle={() => {}}
      />,
    );

    expect(screen.getByText(/REF123/)).toBeTruthy();
  });
});

describe("paymentStatusOf", () => {
  it("is Paid for paid or fulfilled, Cancelled for cancelled, otherwise Unpaid", () => {
    expect(["paid", "preparing", "dispatched", "delivered"].map(paymentStatusOf)).toEqual(Array(4).fill("Paid"));
    expect(paymentStatusOf("cancelled")).toBe("Cancelled");
    expect(["placed", "confirmed", "awaiting payment"].map(paymentStatusOf)).toEqual(Array(3).fill("Unpaid"));
  });
});
