// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelOrder, confirmPickup, quoteDeliveryFee } from "@/features/orders/actions";
import { BackgroundRefresh, REFRESH_INTERVAL_MS } from "@/features/orders/background-refresh";
import { OrderDetailView } from "@/features/orders/order-detail";
import { OrderListView } from "@/features/orders/order-list";
import type { OrderDetail, OrderList, OrderRow } from "@/features/orders/orders";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/orders/actions", () => ({ quoteDeliveryFee: vi.fn(), confirmPickup: vi.fn(), cancelOrder: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
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
  paidBy: null,
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

  it("shows the payment method, amount and who verified the payment", () => {
    render(
      <OrderDetailView
        order={detail({
          status: "paid",
          paymentLabel: "Paid",
          paidBy: { id: "s1", name: "Bernice", at: new Date("2026-10-20T08:00:00Z") },
        })}
      />,
    );

    expect(screen.getByText("Method").nextElementSibling?.textContent).toBe("GCash");
    expect(screen.getByText("Amount").nextElementSibling?.textContent).toBe("₱1,150.00");
    expect(screen.getByText("Verified by").nextElementSibling?.textContent).toContain("Bernice");
  });

  it("shows no Verified by row before the payment is checked", () => {
    render(<OrderDetailView order={detail({ status: "awaiting payment" })} />);

    expect(screen.queryByText("Verified by")).toBeNull();
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

  it("has no action buttons for Staff without the Orders Module", () => {
    for (const status of ["placed", "confirmed", "awaiting payment", "preparing"]) {
      for (const modules of [[], ["Payments"], ["Fulfilment"], ["Payments", "Fulfilment"]]) {
        const { unmount } = render(<OrderDetailView order={detail({ status, deliveryFee: null })} modules={modules} />);
        expect(screen.queryAllByRole("button")).toHaveLength(0);
        unmount();
      }
    }
  });
});

const ORDERS = ["Orders"];

/** A Server Action the test settles by hand, so what shows while it runs can be checked. */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (settle = resolve));
  return { promise, settle };
}

const confirmed = (id: number, deliveryFeeInCentavos: number | null = null) =>
  ({ ok: true as const, order: { id, status: "confirmed", deliveryFeeInCentavos } });

describe("the Orders Module's actions on an Order's detail", () => {
  it("offers a placed Delivery Order a fee quote and cancel, but no plain confirm", () => {
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null })} modules={ORDERS} />);

    expect(screen.getByRole("button", { name: "Quote delivery fee" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm order" })).toBeNull();
  });

  it("offers a placed Pickup Order confirm with no fee", () => {
    render(
      <OrderDetailView
        order={detail({ status: "placed", fulfillmentMethod: "pickup", deliveryFee: null, address: null })}
        modules={ORDERS}
      />,
    );

    expect(screen.getByRole("button", { name: "Confirm order" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quote delivery fee" })).toBeNull();
  });

  it("offers cancel up to preparing, and nothing to confirm once past placed", () => {
    for (const status of ["confirmed", "awaiting payment", "paid", "preparing"]) {
      const { unmount } = render(<OrderDetailView order={detail({ status })} modules={ORDERS} />);
      expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel order"]);
      unmount();
    }
  });

  it("never offers cancel once dispatched, and says so plainly", () => {
    render(<OrderDetailView order={detail({ status: "dispatched" })} modules={ORDERS} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("A dispatched Order cannot be cancelled.")).toBeTruthy();
  });

  it("offers nothing on a delivered or cancelled Order", () => {
    for (const status of ["delivered", "cancelled"]) {
      const { unmount } = render(<OrderDetailView order={detail({ status })} modules={ORDERS} />);
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      unmount();
    }
  });

  it("asks before cancelling, as in the Figma dialog, and sends nothing if Staff keep the Order", () => {
    render(<OrderDetailView order={detail({ status: "paid" })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));

    const dialog = screen.getByRole("alertdialog", { name: "Cancel Order #1042?" });
    expect(within(dialog).getByText("This cannot be undone.")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep order" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("shows a spinner at once while cancelling, and the result only once the server confirms", async () => {
    const pending = deferred<Awaited<ReturnType<typeof cancelOrder>>>();
    vi.mocked(cancelOrder).mockReturnValue(pending.promise);
    render(<OrderDetailView order={detail({ status: "confirmed" })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel order" }));

    // Synchronously after the click: the spinner, and nothing shown as done yet.
    const busy = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelling…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.querySelector("svg.animate-spin")).toBeTruthy();
    expect(cancelOrder).toHaveBeenCalledWith(1042);
    expect(toast.success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => pending.settle({ ok: true, order: { id: 1042, status: "cancelled", deliveryFeeInCentavos: 15_000 } }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Order #1042 cancelled.");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a refusal's reason and does not show the Order as changed", async () => {
    vi.mocked(cancelOrder).mockResolvedValue({ ok: false, reason: "Order already changed; refresh it before trying again." });
    render(<OrderDetailView order={detail({ status: "confirmed" })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel order" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Order already changed; refresh it before trying again."));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    // The page catches up with what the server really holds.
    expect(refresh).toHaveBeenCalled();
  });

  it("tells Staff when the action could not be reached at all", async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new Error("offline"));
    render(<OrderDetailView order={detail({ status: "confirmed" })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel order" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("CREOMS could not save that. Try again in a moment."));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("quotes a Delivery fee in pesos, sends centavos, and confirms once the server does", async () => {
    const pending = deferred<Awaited<ReturnType<typeof quoteDeliveryFee>>>();
    vi.mocked(quoteDeliveryFee).mockReturnValue(pending.promise);
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null, total: 100_000 })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Quote delivery fee" }));

    const dialog = screen.getByRole("alertdialog", { name: "Quote a Delivery fee for Order #1042?" });
    const submit = within(dialog).getByRole("button", { name: "Quote and confirm" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText(/Delivery fee/), { target: { value: "150.50" } });
    expect(within(dialog).getByText("New total").nextElementSibling?.textContent).toBe("₱1,150.50");
    fireEvent.click(submit);

    expect(quoteDeliveryFee).toHaveBeenCalledWith(1042, 15_050);
    expect(within(dialog).getByRole("button", { name: "Confirming…" }).getAttribute("aria-busy")).toBe("true");
    expect(toast.success).not.toHaveBeenCalled();

    await act(async () => pending.settle(confirmed(1042, 15_050)));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Order #1042 confirmed with a ₱150.50 Delivery fee.");
  });

  it("will not send a fee that is not an amount in pesos", () => {
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Quote delivery fee" }));
    const dialog = screen.getByRole("alertdialog");

    for (const value of ["", "-5", "abc", "1.234", "1e3"]) {
      fireEvent.change(within(dialog).getByLabelText(/Delivery fee/), { target: { value } });
      expect((within(dialog).getByRole("button", { name: "Quote and confirm" }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(quoteDeliveryFee).not.toHaveBeenCalled();
  });

  it("shows a refused quote's reason and keeps the fee pending", async () => {
    vi.mocked(quoteDeliveryFee).mockResolvedValue({ ok: false, reason: "Storefront refused the change." });
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Quote delivery fee" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Delivery fee/), { target: { value: "150" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Quote and confirm" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Storefront refused the change."));
    expect(screen.getAllByText("Delivery fee")[0].nextElementSibling?.textContent).toBe("Pending");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("asks before confirming a Pickup Order, then confirms once the server does", async () => {
    vi.mocked(confirmPickup).mockResolvedValue(confirmed(1042));
    render(
      <OrderDetailView
        order={detail({ status: "placed", fulfillmentMethod: "pickup", deliveryFee: null, address: null })}
        modules={ORDERS}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm order" }));

    const dialog = screen.getByRole("alertdialog", { name: "Confirm Order #1042?" });
    expect(within(dialog).queryByLabelText(/Delivery fee/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm order" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order #1042 confirmed."));
    expect(confirmPickup).toHaveBeenCalledWith(1042);
    expect(screen.queryByRole("alertdialog")).toBeNull();
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
