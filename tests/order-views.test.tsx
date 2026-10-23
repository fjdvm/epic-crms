// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelOrder, cancelPaymentOrder, confirmPickup, markPaid, quoteDeliveryFee } from "@/features/orders/actions";
import { BackgroundRefresh, REFRESH_INTERVAL_MS } from "@/features/orders/background-refresh";
import { OrderDetailView } from "@/features/orders/order-detail";
import { OrderListView } from "@/features/orders/order-list";
import type { OrderDetail, OrderList, OrderRow } from "@/features/orders/orders";
import type { PaymentRow } from "@/features/orders/payments";
import { PaymentsView } from "@/features/orders/payment-queue";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/orders/actions", () => ({
  quoteDeliveryFee: vi.fn(),
  confirmPickup: vi.fn(),
  cancelOrder: vi.fn(),
  cancelPaymentOrder: vi.fn(),
  markPaid: vi.fn(),
}));
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
      received: 0,
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
  deliveryPhotoFileId: null,
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

  it("has no Orders actions for Staff without the Orders Module", () => {
    for (const status of ["placed", "confirmed", "awaiting payment", "preparing"]) {
      for (const modules of [[], ["Fulfilment"]]) {
        const { unmount } = render(<OrderDetailView order={detail({ status, deliveryFee: null })} modules={modules} />);
        for (const name of ["Cancel order", "Quote delivery fee", "Confirm order"]) {
          expect(screen.queryByRole("button", { name })).toBeNull();
        }
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

const PAYMENTS = ["Payments"];

const NOW = new Date("2026-10-19T13:02:00Z");

const queued = (overrides: Partial<PaymentRow> = {}): PaymentRow => ({
  id: 1046,
  customer: { id: "c1", name: "Grace Lim" },
  method: "gcash",
  status: "awaiting payment",
  total: 119_700,
  proof: {
    reference: "5012334812",
    screenshot: "https://files.test/receipt.png",
    submittedAt: new Date("2026-10-19T12:52:00Z"),
  },
  ...overrides,
});

const cod = (overrides: Partial<PaymentRow> = {}): PaymentRow =>
  queued({ id: 2001, method: "cash-on-delivery", status: "dispatched", proof: null, total: 50_000, ...overrides });

const renderPayments = (rows: PaymentRow[]) => render(<PaymentsView rows={rows} now={NOW} />);

const paidResult = (id: number) => ({ ok: true as const, order: { id, status: "paid", deliveryFeeInCentavos: null } });

describe("the Payments page", () => {
  it("shows each Order's receipt, GCash reference and amount due side by side, with a link to the Order", () => {
    renderPayments([queued()]);

    const row = screen.getByRole("link", { name: "#1046" }).closest("[data-payment-row]") as HTMLElement;
    expect(screen.getByRole("link", { name: "#1046" }).getAttribute("href")).toBe("/orders/1046");
    expect(within(row).getByText("Grace Lim")).toBeTruthy();
    expect(within(row).getByText("GCash")).toBeTruthy();
    expect(within(row).getByText("5012334812")).toBeTruthy();
    expect(within(row).getByText("₱1,197.00")).toBeTruthy();
    expect(within(row).getByText("10 min ago")).toBeTruthy();
    expect(within(row).getByRole("img", { name: "Receipt for Order #1046" }).getAttribute("src")).toBe(
      "https://files.test/receipt.png",
    );
  });

  it("lists proofs oldest first", () => {
    const at = (h: number) => ({ reference: null, screenshot: null, submittedAt: new Date(`2026-10-19T0${h}:00:00Z`) });
    renderPayments([queued({ id: 7, proof: at(3) }), queued({ id: 9, proof: at(1) }), queued({ id: 8, proof: at(2) })]);

    expect(screen.getAllByRole("link", { name: /^#\d+$/ }).map((a) => a.textContent)).toEqual(["#9", "#8", "#7"]);
  });

  it("shows a reference-only proof without a receipt picture, and a missing reference as a dash", () => {
    renderPayments([queued({ proof: { reference: null, screenshot: null, submittedAt: new Date("2026-10-19T12:52:00Z") } })]);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("No receipt")).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("says so when nothing is waiting", () => {
    renderPayments([]);

    expect(screen.getByText("No GCash Orders are waiting for a payment check.")).toBeTruthy();
  });

  it("counts what is waiting, paid, collected and rejected", () => {
    renderPayments([
      queued({ id: 1 }),
      queued({ id: 2, status: "paid", total: 20_000 }),
      queued({ id: 3, status: "cancelled", total: 30_000 }),
      cod({ id: 4 }),
      cod({ id: 5, status: "delivered", total: 70_000 }),
    ]);

    expect(screen.getByText("Oldest uploaded 10 min ago")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "For verification 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "COD to collect 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Paid 2" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Rejected 1" })).toBeTruthy();
    expect(screen.getByText("2 payments")).toBeTruthy();
    expect(screen.getByText("₱900")).toBeTruthy();
    expect(screen.getByText("1 order · ₱700 collected")).toBeTruthy();
    expect(screen.getByText("₱300 cancelled after proof")).toBeTruthy();
  });

  it("lists Cash on Delivery Orders under their own tab, without a Review button", () => {
    renderPayments([cod()]);
    fireEvent.click(screen.getByRole("tab", { name: "COD to collect 1" }));

    expect(screen.getByRole("link", { name: "#2001" })).toBeTruthy();
    expect(screen.getByText("Cash on delivery", { selector: "div" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  });

  it("opens the verify dialog with the proof beside the amount due, offering Mark paid and Cancel order", () => {
    renderPayments([queued()]);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));

    const dialog = screen.getByRole("dialog", { name: "Verify payment · Order #1046" });
    expect(within(dialog).getByText("Amount due").nextElementSibling?.textContent).toBe("₱1,197.00");
    expect(within(dialog).getByText("Reference no.").nextElementSibling?.textContent).toBe("5012334812");
    expect(within(dialog).getByRole("img", { name: "Receipt for Order #1046" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Mark paid" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel order" })).toBeTruthy();
    expect(markPaid).not.toHaveBeenCalled();
  });

  it("asks before marking paid, then moves the Order to Paid at once, before the server answers", async () => {
    const pending = deferred<Awaited<ReturnType<typeof markPaid>>>();
    vi.mocked(markPaid).mockReturnValue(pending.promise);
    renderPayments([queued()]);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark paid" }));

    const confirm = screen.getByRole("alertdialog", { name: "Mark Order #1046 as paid?" });
    expect(markPaid).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Mark paid" }));

    expect(markPaid).toHaveBeenCalledWith(1046);
    await waitFor(() => expect(screen.queryByRole("link", { name: "#1046" })).toBeNull());
    expect(screen.getByRole("tab", { name: "For verification 0" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Paid 1" })).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();

    await act(async () => pending.settle(paidResult(1046)));

    expect(toast.success).toHaveBeenCalledWith("Order #1046 marked paid.");
    expect(refresh).toHaveBeenCalled();
  });

  it("puts the Order back and says why when the server refuses", async () => {
    vi.mocked(markPaid).mockResolvedValue({ ok: false, reason: "Order already changed; refresh it before trying again." });
    renderPayments([queued()]);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark paid" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark paid" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Order already changed; refresh it before trying again."));
    expect(toast.success).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("tab", { name: "For verification 1" })).toBeTruthy());
  });

  it("cancels through the Payments Module's own action, after asking", async () => {
    vi.mocked(cancelPaymentOrder).mockResolvedValue({ ok: true, order: { id: 1046, status: "cancelled", deliveryFeeInCentavos: null } });
    renderPayments([queued()]);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel order" }));

    const confirm = screen.getByRole("alertdialog", { name: "Cancel Order #1046?" });
    expect(cancelPaymentOrder).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel order" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order #1046 cancelled."));
    expect(cancelPaymentOrder).toHaveBeenCalledWith(1046);
    expect(cancelOrder).not.toHaveBeenCalled();
  });
});

describe("the Payments Module's actions on an Order's detail", () => {
  const awaiting = (overrides: Partial<OrderDetail> = {}) =>
    detail({
      status: "awaiting payment",
      paymentProof: { reference: "1234567890", screenshot: null, submittedAt: new Date("2026-10-20T01:00:00Z") },
      ...overrides,
    });

  it("offers Mark paid and Cancel order for a GCash Order awaiting payment, and nothing from the Orders Module", () => {
    render(<OrderDetailView order={awaiting()} modules={PAYMENTS} />);

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel order", "Mark paid"]);
  });

  it("marks paid through the dialog, and cancels through the Payments action", async () => {
    vi.mocked(markPaid).mockResolvedValue(paidResult(1042));
    vi.mocked(cancelPaymentOrder).mockResolvedValue({ ok: true, order: { id: 1042, status: "cancelled", deliveryFeeInCentavos: null } });
    render(<OrderDetailView order={awaiting()} modules={PAYMENTS} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Mark Order #1042 as paid?" })).getByRole("button", { name: "Mark paid" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Order #1042 marked paid."));
    expect(markPaid).toHaveBeenCalledWith(1042);

    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel order" }));
    await waitFor(() => expect(cancelPaymentOrder).toHaveBeenCalledWith(1042));
  });

  it("offers no Mark paid before proof is submitted, or once the Order has moved on", () => {
    const { unmount } = render(<OrderDetailView order={detail({ status: "awaiting payment" })} modules={PAYMENTS} />);
    expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull();
    unmount();

    for (const status of ["confirmed", "paid", "preparing", "dispatched", "delivered", "cancelled"]) {
      const view = render(<OrderDetailView order={awaiting({ status })} modules={PAYMENTS} />);
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      view.unmount();
    }
  });

  it("offers no Mark paid for a Cash on Delivery Order", () => {
    render(<OrderDetailView order={awaiting({ paymentMethod: "cash-on-delivery" })} modules={PAYMENTS} />);

    expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull();
  });

  it("shows one Cancel order, not two, to Staff with both the Orders and Payments Modules", () => {
    render(<OrderDetailView order={awaiting()} modules={[...ORDERS, ...PAYMENTS]} />);

    expect(screen.getAllByRole("button", { name: "Cancel order" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Mark paid" })).toBeTruthy();
  });

  it("shows who marked an Order paid and when", () => {
    render(
      <OrderDetailView
        order={detail({ status: "paid", paymentLabel: "Paid", paidBy: { id: "s1", name: "Bernice", at: new Date("2026-10-20T08:00:00Z") } })}
        modules={PAYMENTS}
      />,
    );

    expect(screen.getByText("Verified by").nextElementSibling?.textContent).toBe("Bernice · 20 Oct 2026");
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


describe("Returns-only Order detail access", () => {
  it("shows Order context and a Returns back link without Orders, Payments or Fulfilment actions", () => {
    for (const status of ["placed", "confirmed", "awaiting payment", "paid", "preparing", "dispatched", "delivered"]) {
      const view = render(<OrderDetailView order={detail({ status })} modules={["Returns"]} />);
      expect(screen.getByRole("heading", { name: "Order #1042" })).toBeTruthy();
      expect(screen.getByRole("link", { name: /← Returns/ }).getAttribute("href")).toBe("/returns");
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      view.unmount();
    }
  });
});


describe("received Orders", () => {
  it("shows completed progress and paid status without allowing another Staff move", () => {
    render(<OrderDetailView order={detail({ status: "received", paymentLabel: "Paid" })} modules={["Orders", "Payments", "Fulfilment"]} />);
    const progress = screen.getByRole("list", { name: "Order progress" });
    const current = within(progress).getAllByRole("listitem").find(item => item.getAttribute("aria-current") === "step");
    expect(current?.textContent).toBe("Received");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
