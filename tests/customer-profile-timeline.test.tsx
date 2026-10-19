// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CustomerOrder } from "@/features/customer-profiles/orders";
import { ActivityTimeline } from "@/features/customer-profiles/activity-timeline";
import { activityOf } from "@/features/customer-profiles/timeline";

afterEach(cleanup);

const order = (over: Partial<CustomerOrder>): CustomerOrder => ({
  id: 1,
  createdAt: new Date("2026-03-01T04:00:00Z"),
  status: "placed",
  fulfillmentMethod: "delivery",
  paymentMethod: "cash-on-delivery",
  lines: [],
  subtotal: 0,
  deliveryFee: null,
  total: 0,
  address: null,
  feedback: null,
  paymentProof: null,
  ...over,
});

describe("activityOf", () => {
  it("lists placed Orders, payment proof and feedback, newest first, each tied to its Order", () => {
    const entries = activityOf([
      order({
        id: 2,
        createdAt: new Date("2026-03-10T00:00:00Z"),
        paymentMethod: "gcash",
        paymentProof: { reference: "R1", screenshot: null, submittedAt: new Date("2026-03-11T00:00:00Z") },
        feedback: { rating: 5, comment: "Great", createdAt: new Date("2026-03-20T00:00:00Z") },
      }),
      order({ id: 1, createdAt: new Date("2026-03-01T00:00:00Z") }),
    ]);

    expect(entries.map((e) => [e.kind, e.orderId])).toEqual([
      ["feedback", 2],
      ["payment-proof", 2],
      ["placed", 2],
      ["placed", 1],
    ]);
  });

  it("is empty for a Customer with no activity", () => {
    expect(activityOf([])).toEqual([]);
  });
});

describe("ActivityTimeline", () => {
  it("links each entry to its Order", () => {
    const open = vi.fn();
    render(
      <ActivityTimeline
        orders={[order({ id: 9, feedback: { rating: 4, comment: null, createdAt: new Date("2026-03-05T00:00:00Z") } })]}
        onOpenOrder={open}
      />,
    );

    const links = screen.getAllByRole("link", { name: "Order #9" });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("#order-9");
    fireEvent.click(links[1]);
    expect(open).toHaveBeenCalledWith(9);
    expect(screen.getByText(/left 4 \/ 5 feedback/i)).toBeTruthy();
  });

  it("shows an empty state with no activity", () => {
    render(<ActivityTimeline orders={[]} onOpenOrder={() => {}} />);

    expect(screen.getByText(/no activity yet/i)).toBeTruthy();
  });
});
