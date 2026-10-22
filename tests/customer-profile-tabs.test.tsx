// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CartTab } from "@/features/customer-profiles/cart-tab";
import { EmailsTab } from "@/features/customer-profiles/emails-tab";
import { FeedbackTab } from "@/features/customer-profiles/feedback-tab";
import type { CustomerOrder } from "@/features/customer-profiles/orders";
import type { EmailReceived } from "@/features/marketing/announcements";

afterEach(cleanup);

const order = (over: Partial<CustomerOrder>): CustomerOrder => ({
  id: 1,
  createdAt: new Date("2026-03-01T04:00:00Z"),
  status: "delivered",
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

describe("CartTab", () => {
  it("shows each line with Product, Size, quantity, price and the Cart total", () => {
    render(
      <CartTab
        cart={{
          lines: [
            { product: "Ube Powder", size: "100g", quantity: 2, price: 21900 },
            { product: "Ube Jam", size: "200g", quantity: 1, price: 30000 },
          ],
          total: 73800,
        }}
      />,
    );

    expect(screen.getByText("Ube Powder")).toBeTruthy();
    expect(screen.getByText("100g")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("₱219.00")).toBeTruthy();
    expect(screen.getByText("Ube Jam")).toBeTruthy();
    expect(screen.getByText("₱738.00")).toBeTruthy();
  });

  it("shows the empty state for an empty Cart", () => {
    render(<CartTab cart={{ lines: [], total: 0 }} />);

    expect(screen.getByText(/cart is empty/i)).toBeTruthy();
  });
});

describe("FeedbackTab", () => {
  it("lists every Order feedback entry with a link to its Order", () => {
    const open = vi.fn();
    render(
      <FeedbackTab
        orders={[
          order({ id: 7, feedback: { rating: 5, comment: "Great", createdAt: new Date("2026-03-02T00:00:00Z"), sentiment: null } }),
          order({ id: 6 }),
          order({ id: 4, feedback: { rating: 2, comment: null, createdAt: new Date("2026-03-02T00:00:00Z"), sentiment: null } }),
        ]}
        onOpenOrder={open}
      />,
    );

    expect(screen.getByText("5 / 5")).toBeTruthy();
    expect(screen.getByText("Great")).toBeTruthy();
    expect(screen.getByText("2 / 5")).toBeTruthy();
    expect(screen.queryByText("Order #6")).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Order #4" }));
    expect(open).toHaveBeenCalledWith(4);
    expect(screen.getByRole("link", { name: "Order #7" }).getAttribute("href")).toBe("#order-7");
  });

  it("shows each Feedback's Sentiment badge, or Analysing… until it is labelled", () => {
    render(
      <FeedbackTab
        orders={[
          order({ id: 7, feedback: { rating: 5, comment: "Great", createdAt: new Date(), sentiment: "positive" } }),
          order({ id: 4, feedback: { rating: 2, comment: "Meh", createdAt: new Date(), sentiment: null } }),
        ]}
        onOpenOrder={() => {}}
      />,
    );

    expect(screen.getByText("Positive")).toBeTruthy();
    expect(screen.getByText("Analysing…")).toBeTruthy();
  });

  it("shows the Order's products", () => {
    render(
      <FeedbackTab
        orders={[
          order({
            id: 7,
            lines: [
              { product: "Smooth tub", size: "200g", quantity: 1, price: 100 },
              { product: "Smooth tub", size: "500g", quantity: 1, price: 100 },
              { product: "Tidbits pouch", size: "", quantity: 2, price: 100 },
            ],
            feedback: { rating: 5, comment: "Great", createdAt: new Date(), sentiment: "positive" },
          }),
        ]}
        onOpenOrder={() => {}}
      />,
    );

    expect(screen.getByText("Smooth tub, Tidbits pouch")).toBeTruthy();
  });

  it("shows the empty state when no Order has feedback", () => {
    render(<FeedbackTab orders={[order({})]} onOpenOrder={() => {}} />);

    expect(screen.getByText(/no feedback/i)).toBeTruthy();
  });
});

const email = (over: Partial<EmailReceived>): EmailReceived => ({
  id: "a1",
  title: "Undas ube treats",
  description: "Our ube treats are back.",
  images: [],
  imageLayout: null,
  receivedAt: new Date("2026-10-20T04:00:00Z"),
  ...over,
});

describe("EmailsTab", () => {
  it("shows the opt-in status and the empty state", () => {
    const { rerender } = render(<EmailsTab marketingOptIn emails={[]} />);
    expect(screen.getByText("Opted in")).toBeTruthy();
    expect(screen.getByText(/no marketing emails/i)).toBeTruthy();

    rerender(<EmailsTab marketingOptIn={false} emails={[]} />);
    expect(screen.getByText("Not opted in")).toBeTruthy();
  });

  it("lists each email with its title and the date it was sent, in the order given", () => {
    render(
      <EmailsTab
        marketingOptIn
        emails={[email({ id: "b", title: "Halaya restock" }), email({ id: "a", title: "Undas ube treats", receivedAt: new Date("2026-10-01T04:00:00Z") })]}
      />,
    );

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("Halaya restock");
    expect(items[0]).toContain("20 Oct 2026");
    expect(items[1]).toContain("Undas ube treats");
    expect(items[1]).toContain("1 Oct 2026");
  });

  it("opens an entry to show the Announcement as it was received", () => {
    render(<EmailsTab marketingOptIn emails={[email({ title: "Halaya restock", description: "Back in stock today." })]} />);
    expect(screen.queryByTestId("inbox-preview")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /halaya restock/i }));

    const preview = screen.getByTestId("inbox-preview");
    expect(preview.textContent).toContain("Halaya restock");
    expect(preview.textContent).toContain("Back in stock today.");
  });

  it("says the list could not be read, rather than that nothing was sent", () => {
    render(<EmailsTab marketingOptIn emails={null} />);

    expect(screen.getByText(/could not be read/i)).toBeTruthy();
    expect(screen.queryByText(/no marketing emails/i)).toBeNull();
  });
});
