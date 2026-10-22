// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackgroundRefresh, REFRESH_INTERVAL_MS } from "@/features/orders/background-refresh";
import { OrderDetailView } from "@/features/orders/order-detail";
import { OrderListView } from "@/features/orders/order-list";
import type { OrderDetail, OrderList, OrderRow } from "@/features/orders/orders";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  refresh.mockClear();
});

const row = (overrides: Partial<OrderRow>): OrderRow => ({
  id: 1042,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  customerId: "c1",
  customerName: "Maria Santos",
  lines: [{ product: "Halaya", quantity: 2 }],
  total: 115_000,
  status: "confirmed",
  paymentLabel: "Unpaid",
  ...overrides,
});

function list(rows: OrderRow[]) {
  const value: OrderList = {
    rows,
    counts: {
      all: 12,
      placed: 3,
      confirmed: 2,
      "awaiting payment": 1,
      paid: 2,
      preparing: 1,
      dispatched: 1,
      delivered: 1,
      cancelled: 1,
    },
    page: 1,
    pageSize: 25,
    totalPages: 1,
  };

  return render(<OrderListView list={value} params={{ tab: "all", page: 1 }} />);
}

describe("the Orders list", () => {
  it("has a tab per storefront status with its count, and not the design's names", () => {
    list([row({})]);

    for (const name of [
      "All 12",
      "Placed 3",
      "Confirmed 2",
      "Awaiting payment 1",
      "Paid 2",
      "Preparing 1",
      "Dispatched 1",
      "Delivered 1",
      "Cancelled 1",
    ]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    for (const design of ["Pending", "Packed", "Shipped"]) {
      expect(screen.queryByRole("link", { name: new RegExp(design) })).toBeNull();
    }
  });

  it("links each tab to its own address and marks the current one", () => {
    list([row({})]);

    expect(screen.getByRole("link", { name: "Awaiting payment 1" }).getAttribute("href")).toBe(
      "/orders?tab=awaiting+payment",
    );
    expect(screen.getByRole("link", { name: "All 12" }).getAttribute("href")).toBe("/orders");
    expect(screen.getByRole("link", { name: "All 12" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows each row's number, date, Customer, items, total, payment label and status", () => {
    list([row({})]);

    const link = screen.getByRole("link", { name: "#1042" });
    expect(link.getAttribute("href")).toBe("/orders/1042");

    const rowEl = link.closest("[data-order-row]") as HTMLElement;
    expect(within(rowEl).getByText("20 Oct 2026")).toBeTruthy();
    expect(within(rowEl).getByText("Maria Santos")).toBeTruthy();
    expect(within(rowEl).getByText("Halaya ×2")).toBeTruthy();
    expect(within(rowEl).getByText("₱1,150.00")).toBeTruthy();
    expect(within(rowEl).getByText("Unpaid")).toBeTruthy();
    expect(within(rowEl).getByText("Confirmed")).toBeTruthy();
  });

  it("labels a paid, a cancelled and an awaiting-payment Order from their status", () => {
    list([
      row({ id: 3, status: "preparing", paymentLabel: "Paid" }),
      row({ id: 2, status: "cancelled", paymentLabel: "Cancelled" }),
      row({ id: 1, status: "awaiting payment", paymentLabel: "Unpaid" }),
    ]);

    const rowFor = (id: number) => screen.getByRole("link", { name: `#${id}` }).closest("[data-order-row]") as HTMLElement;

    expect(within(rowFor(3)).getByText("Paid")).toBeTruthy();
    expect(within(rowFor(3)).getByText("Preparing")).toBeTruthy();
    expect(within(rowFor(2)).getAllByText("Cancelled")).toHaveLength(2);
    expect(within(rowFor(1)).getByText("Awaiting payment")).toBeTruthy();
  });

  it("says so when a tab has no Orders", () => {
    list([]);

    expect(screen.getByText("No Orders here.")).toBeTruthy();
  });

  it("has no action buttons", () => {
    list([row({})]);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

const detail = (overrides: Partial<OrderDetail>): OrderDetail => ({
  id: 1042,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  status: "confirmed",
  fulfillmentMethod: "delivery",
  paymentMethod: "gcash",
  lines: [{ product: "Halaya", size: "500g", quantity: 2, price: 50_000 }],
  subtotal: 100_000,
  deliveryFee: 15_000,
  total: 115_000,
  address: {
    label: "Home",
    street: "1 Rizal St",
    barangay: "Poblacion",
    city: "Makati",
    province: "Metro Manila",
    postalCode: "1210",
    country: "Philippines",
  },
  feedback: null,
  paymentProof: null,
  paymentLabel: "Unpaid",
  customer: { id: "c1", name: "Maria Santos" },
  ...overrides,
});

describe("an Order's detail", () => {
  it("shows the items, Delivery fee, total, address and a link to the Customer Profile", () => {
    render(<OrderDetailView order={detail({})} />);

    expect(screen.getByText("Halaya")).toBeTruthy();
    expect(screen.getByText("500g")).toBeTruthy();
    expect(screen.getByText("Delivery fee").nextElementSibling?.textContent).toBe("₱150.00");
    expect(screen.getByText("Total").nextElementSibling?.textContent).toBe("₱1,150.00");
    expect(screen.getByText(/1 Rizal St, Poblacion, Makati/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Maria Santos" }).getAttribute("href")).toBe("/customer-profiles/c1");
  });

  it("shows no Delivery fee row and no address for a Pickup Order", () => {
    render(
      <OrderDetailView order={detail({ fulfillmentMethod: "pickup", deliveryFee: null, total: 100_000, address: null })} />,
    );

    expect(screen.queryByText("Delivery fee")).toBeNull();
    expect(screen.getByText("Pickup")).toBeTruthy();
    expect(screen.queryByText(/Delivery address/)).toBeNull();
  });

  it("shows the fee as pending for a Delivery Order not yet quoted", () => {
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null, total: 100_000 })} />);

    expect(screen.getByText("Delivery fee").nextElementSibling?.textContent).toBe("Pending");
  });

  it("shows the GCash Payment proof", () => {
    render(
      <OrderDetailView
        order={detail({
          status: "awaiting payment",
          paymentProof: {
            reference: "1234567890",
            screenshot: "https://files.test/proof.png",
            submittedAt: new Date("2026-10-20T01:00:00Z"),
          },
        })}
      />,
    );

    expect(screen.getByText(/1234567890/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /Payment proof/ }).getAttribute("src")).toBe("https://files.test/proof.png");
  });

  it("says no proof has been submitted yet for a GCash Order awaiting payment", () => {
    render(<OrderDetailView order={detail({ status: "awaiting payment" })} />);

    expect(screen.getByText("No Payment proof submitted yet.")).toBeTruthy();
  });

  it("shows the progress with the current status, using the storefront's statuses", () => {
    render(<OrderDetailView order={detail({ status: "paid" })} />);

    const steps = screen.getByRole("list", { name: "Order progress" });
    const names = within(steps).getAllByRole("listitem").map((li) => li.textContent);

    expect(names).toEqual(["Placed", "Confirmed", "Awaiting payment", "Paid", "Preparing", "Dispatched", "Delivered"]);
    expect(within(steps).getByText("Paid").closest("li")?.getAttribute("aria-current")).toBe("step");
    expect(within(steps).getByText("Placed").closest("li")?.getAttribute("data-done")).toBe("true");
    expect(within(steps).getByText("Preparing").closest("li")?.getAttribute("data-done")).toBe("false");
  });

  it("leaves the payment steps out for Cash on Delivery and Pickup Orders", () => {
    render(<OrderDetailView order={detail({ paymentMethod: "cash-on-delivery", status: "confirmed" })} />);

    const names = within(screen.getByRole("list", { name: "Order progress" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);

    expect(names).toEqual(["Placed", "Confirmed", "Preparing", "Dispatched", "Delivered"]);
  });

  it("shows a cancelled Order as cancelled instead of a progress", () => {
    render(<OrderDetailView order={detail({ status: "cancelled", paymentLabel: "Cancelled" })} />);

    expect(screen.queryByRole("list", { name: "Order progress" })).toBeNull();
    expect(screen.getByText("This Order was cancelled.")).toBeTruthy();
  });

  it("has no action buttons yet", () => {
    render(<OrderDetailView order={detail({ status: "awaiting payment" })} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("keeping a page fresh", () => {
  it("refreshes in the background well inside 30 seconds, while the page is visible", () => {
    vi.useFakeTimers();
    render(<BackgroundRefresh />);
    refresh.mockClear();

    expect(REFRESH_INTERVAL_MS).toBeLessThanOrEqual(20_000);

    act(() => void vi.advanceTimersByTime(REFRESH_INTERVAL_MS));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => void vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 2));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("refreshes at once on opening, since the page may have come from the cache", () => {
    vi.useFakeTimers();
    render(<BackgroundRefresh />);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh while the tab is hidden, and refreshes when it comes back", () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<BackgroundRefresh />);
    refresh.mockClear();

    act(() => void vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(refresh).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it("stops when the page unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = render(<BackgroundRefresh />);
    unmount();
    refresh.mockClear();

    act(() => void vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 3));
    expect(refresh).not.toHaveBeenCalled();
  });
});
