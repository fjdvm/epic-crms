// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomerProfileView } from "@/features/customer-profiles/customer-profile";
import type { CustomerProfile } from "@/features/customer-profiles/profile";
import { OrderDetailView } from "@/features/orders/order-detail";
import type { OrderDetail } from "@/features/orders/orders";
import type { ReturnRow } from "@/features/returns/returns";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), back: vi.fn(), push: vi.fn() }) }));
vi.mock("@/features/orders/actions", () => ({
  quoteDeliveryFee: vi.fn(),
  confirmPickup: vi.fn(),
  cancelOrder: vi.fn(),
  cancelPaymentOrder: vi.fn(),
  markPaid: vi.fn(),
  startPreparing: vi.fn(),
  dispatchOrder: vi.fn(),
  deliverOrder: vi.fn(),
}));

afterEach(cleanup);

const ret = (overrides: Partial<ReturnRow>): ReturnRow => ({
  id: 15,
  number: "RMA-15",
  orderId: 1042,
  customer: { id: "c1", name: "Maria Santos" },
  status: "requested",
  requestedAt: new Date("2026-10-20T00:00:00Z"),
  amount: 21_900,
  items: [{ orderLineId: 1, product: "Smooth tub", size: "250g", quantity: 2, price: 10_950 }],
  ...overrides,
});

const RETURNS = ["Returns"];

const detail = (overrides: Partial<OrderDetail> = {}): OrderDetail => ({
  deliveryPhotoFileId: null,
  paidBy: null,
  id: 1042,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  status: "delivered",
  fulfillmentMethod: "delivery",
  paymentMethod: "cash-on-delivery",
  lines: [{ product: "Halaya", size: "500g", quantity: 2, price: 50_000 }],
  subtotal: 100_000,
  deliveryFee: 15_000,
  total: 115_000,
  address: null,
  feedback: null,
  paymentProof: null,
  paymentLabel: "Paid",
  customer: { id: "c1", name: "Maria Santos" },
  ...overrides,
});

describe("Returns on the Order detail page", () => {
  it("lists the Order's Returns with number, status and amount", () => {
    render(
      <OrderDetailView
        order={detail()}
        modules={RETURNS}
        returns={[ret({}), ret({ id: 16, number: "RMA-16", status: "refunded", amount: 5_000 })]}
      />,
    );

    const card = screen.getByRole("heading", { name: "Returns" }).closest("section") as HTMLElement;
    const rows = within(card).getAllByRole("row").slice(1);

    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("RMA-15")).toBeTruthy();
    expect(within(rows[0]).getByText("Requested")).toBeTruthy();
    expect(within(rows[0]).getByText("₱219.00")).toBeTruthy();
    expect(within(rows[1]).getByText("RMA-16")).toBeTruthy();
    expect(within(rows[1]).getByText("Refunded")).toBeTruthy();
    expect(within(rows[1]).getByText("₱50.00")).toBeTruthy();
  });

  it("says so when the Order has no Returns", () => {
    render(<OrderDetailView order={detail()} modules={RETURNS} returns={[]} />);

    expect(screen.getByText("No Returns on this Order.")).toBeTruthy();
  });

  it("says so when the Returns could not be read, without hiding the Order", () => {
    render(<OrderDetailView order={detail()} modules={RETURNS} returns={null} />);

    expect(screen.getByText(/Returns could not be loaded/)).toBeTruthy();
    expect(screen.getByText("Halaya")).toBeTruthy();
  });

  it("shows no Returns, and no Return action, to Staff without the Returns Module", () => {
    for (const modules of [[], ["Orders"], ["Payments", "Fulfilment"]]) {
      const view = render(<OrderDetailView order={detail()} returns={[ret({})]} modules={modules} />);

      expect(screen.queryByRole("heading", { name: "Returns" })).toBeNull();
      expect(screen.queryByText("RMA-15")).toBeNull();
      view.unmount();
    }
  });

  it("offers Returns Staff no Return action yet: the card only reads", () => {
    render(<OrderDetailView order={detail()} returns={[ret({})]} modules={RETURNS} />);

    const card = screen.getByRole("heading", { name: "Returns" }).closest("section") as HTMLElement;

    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(within(card).queryAllByRole("link")).toHaveLength(0);
  });

  it("shows a received Order as a status with its own step", () => {
    render(<OrderDetailView order={detail({ status: "received" })} />);

    expect(screen.getAllByText("Received").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("list", { name: "Order progress" }).querySelector("[aria-current=step]")?.textContent).toContain(
      "Received",
    );
  });
});

const profile = (overrides: Partial<CustomerProfile> = {}): CustomerProfile => ({
  id: "c1",
  name: "Maria Santos",
  firstName: "Maria",
  middleName: null,
  lastName: "Santos",
  email: "maria@example.com",
  contactNumber: "0917 555 0142",
  marketingOptIn: true,
  customerSince: new Date("2026-03-01T00:00:00Z"),
  stage: "repeat",
  defaultCity: "Antipolo",
  orders: 1,
  totalSpent: 115_000,
  averageOrder: 115_000,
  lastOrder: new Date("2026-10-12T00:00:00Z"),
  feedbackCount: 0,
  averageRating: null,
  addresses: [],
  orderHistory: [],
  cart: { lines: [], total: 0 },
  walkIn: null,
  emailsReceived: [],
  mergedWalkIn: null,
  returns: [],
  ...overrides,
});

function openReturnsTab(name: string) {
  const tab = screen.getByRole("tab", { name });

  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

describe("Returns on the Customer Profile", () => {
  it("lists the Customer's Returns in their own tab, with the Order each belongs to", () => {
    render(
      <CustomerProfileView
        profile={profile({ returns: [ret({}), ret({ id: 16, number: "RMA-16", orderId: 1001, status: "declined" })] })}
        canOpenOrder
        canViewReturns
      />,
    );

    openReturnsTab("Returns (2)");

    const rows = screen.getAllByRole("row").slice(1);

    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("RMA-15")).toBeTruthy();
    expect(within(rows[0]).getByRole("link", { name: "#1042" }).getAttribute("href")).toBe("/orders/1042");
    expect(within(rows[0]).getByText("Requested")).toBeTruthy();
    expect(within(rows[0]).getByText("₱219.00")).toBeTruthy();
    expect(within(rows[1]).getByText("Declined")).toBeTruthy();
  });

  it("does not link to Orders the viewer cannot open", () => {
    render(<CustomerProfileView profile={profile({ returns: [ret({})] })} canViewReturns />);

    openReturnsTab("Returns (1)");

    expect(screen.queryByRole("link", { name: "#1042" })).toBeNull();
    expect(screen.getByText("#1042")).toBeTruthy();
  });

  it("shows no Returns tab to Staff without the Returns Module", () => {
    render(<CustomerProfileView profile={profile({ returns: [ret({})] })} />);

    expect(screen.queryByRole("tab", { name: /Returns/ })).toBeNull();
    expect(screen.queryByText("RMA-15")).toBeNull();
  });

  it("says so for a Customer with no Returns", () => {
    render(<CustomerProfileView profile={profile()} canViewReturns />);

    openReturnsTab("Returns (0)");

    expect(screen.getByText("This customer has no Returns.")).toBeTruthy();
  });

  it("says so when the Returns could not be read", () => {
    render(<CustomerProfileView profile={profile({ returns: null })} canViewReturns />);

    openReturnsTab("Returns");

    expect(screen.getByText(/Returns could not be loaded/)).toBeTruthy();
  });
});
