// @vitest-environment jsdom
import { proofOutcome } from "@/features/orders/proof-account";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelOrder, cancelPaymentOrder, markPaid, quoteDeliveryFee, rejectOrder, rejectPaymentProof, resendStatusEmail } from "@/features/orders/actions";
import { OrderDetailView } from "@/features/orders/order-detail";
import { OrderListView } from "@/features/orders/order-list";
import type { OrderDetail, OrderList, OrderRow } from "@/features/orders/orders";
import type { PaymentRow } from "@/features/orders/payments";
import { PaymentsView } from "@/features/orders/payment-queue";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/orders/actions", () => ({
  loadPackingSlip: vi.fn(),
  quoteDeliveryFee: vi.fn(),
  cancelOrder: vi.fn(),
  rejectOrder: vi.fn(),
  cancelPaymentOrder: vi.fn(),
  markPaid: vi.fn(),
  rejectPaymentProof: vi.fn(),
  resendStatusEmail: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

/** Every button except the Back navigation, which is not an action. */
const NAV = new Set(["Orders", "Returns", "Tickets"]);
const actionButtons = () => screen.queryAllByRole("button").filter((b) => !NAV.has(b.textContent ?? ""));


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
      returned: 2,
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
      "Returned 2",
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
    expect(screen.getByRole("link", { name: "Returned 2" }).getAttribute("href")).toBe("/orders?tab=returned");
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

    expect(actionButtons()).toHaveLength(0);
  });
});

const detail = (overrides: Partial<OrderDetail>): OrderDetail => ({
  paymentProofs: [],
  proofRejections: 0,
  deliveryPhotoFileId: null,
  deliveryPhotoRemovedAt: null,
  paidBy: null,
  codCollection: null,
  packedBy: null,
  id: 1042,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  status: "confirmed",
  fulfillmentMethod: "delivery",
  paymentMethod: "gcash",
  lines: [{ product: "Halaya", size: "500g", quantity: 2, price: 50_000 }],
  subtotal: 100_000,
  discount: 0,
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
  it("shows Senior/PWD status, and Verified once approved", () => {
    const { unmount } = render(<OrderDetailView role="staff" order={detail({})} modules={["Orders"]} returns={[]} reservations={new Map()} />);
    expect(screen.getByTestId("senior-pwd-status").textContent).toBe("Not verified");
    unmount();
    render(<OrderDetailView role="staff" order={detail({ deliveryFee: 0, seniorPwd: { id: 1, idType: "pwd", status: "approved" } })} modules={["Orders"]} returns={[]} reservations={new Map()} />);
    expect(screen.getByTestId("senior-pwd-status").textContent).toBe("PWD · Verified");
  });

  it("shows no discount section on an Order without a discount", () => {
    render(<OrderDetailView role="staff" order={detail({})} modules={["Orders"]} returns={[]} reservations={new Map()} />);
    expect(screen.queryByTestId("senior-pwd-discount")).toBeNull();
    expect(screen.queryByTestId("approved-discount")).toBeNull();
  });

  it("shows the approved discount and allowance used, with no reduction note when uncapped", () => {
    render(<OrderDetailView role="staff" order={detail({ discount: 5_000, total: 110_000, seniorPwd: { id: 1, idType: "senior", status: "approved" }, discountDetail: { allowanceUsed: 5_000, reductionReason: null } })} modules={["Orders"]} returns={[]} reservations={new Map()} />);
    expect(screen.getByTestId("approved-discount").textContent).toBe("₱50.00");
    expect(screen.getByTestId("allowance-used").textContent).toBe("₱50.00 of ₱125.00");
    expect(screen.queryByRole("note", { name: "Discount reduced" })).toBeNull();
  });

  it("shows the reduction reason when the weekly cap reduced the discount, and never an ID number", () => {
    const { container } = render(<OrderDetailView role="staff" order={detail({ discount: 2_500, total: 112_500, seniorPwd: { id: 1, idType: "pwd", status: "approved" }, discountDetail: { allowanceUsed: 12_500, reductionReason: "Only ₱25.00 of this ID's ₱125.00 weekly allowance was left." } })} modules={["Orders"]} returns={[]} reservations={new Map()} />);
    expect(screen.getByTestId("allowance-used").textContent).toBe("₱125.00 of ₱125.00");
    expect(screen.getByRole("note", { name: "Discount reduced" }).textContent).toContain("weekly allowance was left");
    expect(container.textContent).not.toMatch(/id[_ ]?(number|hash)/i);
  });

  it("links to the review screen while the ID waits, and explains why Confirm and Quote are blocked", () => {
    render(<OrderDetailView role="staff" order={detail({ status: "placed", deliveryFee: null, seniorPwd: { id: 1, idType: "senior", status: "pending" } })} modules={["Orders"]} returns={[]} reservations={new Map()} />);
    expect(screen.getByTestId("senior-pwd-status").textContent).toBe("Senior Citizen · Waiting for review");
    expect(screen.getByRole("link", { name: "Review the ID" }).getAttribute("href")).toBe("/approvals?type=id-check");
    expect(screen.getByRole("note", { name: "Senior/PWD review first" }).textContent).toContain("before confirming");
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("shows a ₱0 fee as free delivery on any subtotal, with no subtotal rule note", () => {
    render(<OrderDetailView order={detail({ subtotal: 100_000, deliveryFee: 0, total: 100_000 })} />);
    expect(screen.getAllByText("Free delivery").length).toBeGreaterThan(0);
    expect(screen.getByText("Free · ₱0")).toBeTruthy();
    expect(screen.queryByRole("note", { name: "Free delivery rule" })).toBeNull();
    expect(screen.queryByRole("note", { name: "Quote again" })).toBeNull();
    cleanup();
    render(<OrderDetailView order={detail({})} />);
    expect(screen.queryByText("Free · ₱0")).toBeNull();
  });

  it("shows the items, Delivery fee, total, address and a link to the Customer Profile", () => {
    render(<OrderDetailView order={detail({})} />);

    expect(screen.getByText("Halaya")).toBeTruthy();
    expect(screen.getByText("500g")).toBeTruthy();
    expect(screen.getByText("Delivery fee").nextElementSibling?.textContent).toBe("₱150.00");
    expect(screen.getByText("Total").nextElementSibling?.textContent).toBe("₱1,150.00");
    expect(screen.getByText(/1 Rizal St, Poblacion, Makati/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Maria Santos" }).getAttribute("href")).toBe("/customer-profiles/c1");
  });

  it("shows Country, Region, Province, City, Barangay and Street for an Order with a Region", () => {
    const base = detail({}).address!;
    render(<OrderDetailView order={detail({ address: { ...base, region: "NCR" } })} />);

    for (const [label, value] of [["Country", "Philippines"], ["Region", "NCR"], ["Province", "Metro Manila"], ["City", "Makati"], ["Barangay", "Poblacion"], ["Street", "1 Rizal St"]]) {
      expect(screen.getByText(label).nextElementSibling?.textContent).toBe(value);
    }
  });

  it("shows an older Order's address as the original plain text", () => {
    render(<OrderDetailView order={detail({})} />);

    expect(screen.queryByLabelText("Structured delivery address")).toBeNull();
    expect(screen.getByText("1 Rizal St, Poblacion, Makati, Metro Manila 1210, Philippines")).toBeTruthy();
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
            rejectedAt: null,
          },
          paymentProofs: [{ id: 1, reference: "1234567890", screenshot: "https://files.test/proof.png", submittedAt: new Date("2026-10-20T01:00:00Z"), rejection: null }],
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

  it("shows Payment collected with the amount and time once a COD Order's cash was recorded", () => {
    render(<OrderDetailView order={detail({ status: "delivered", paymentMethod: "cash-on-delivery", codCollection: { amountInCentavos: 115_000, at: new Date("2026-10-21T08:00:00Z"), byName: "Ana" } })} />);
    expect(screen.getByText("Payment collected").nextElementSibling?.textContent).toContain("₱1,150.00");
  });

  it("shows no Payment collected row before the cash is recorded", () => {
    render(<OrderDetailView order={detail({ status: "dispatched", paymentMethod: "cash-on-delivery" })} />);
    expect(screen.queryByText("Payment collected")).toBeNull();
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

  it("leaves the payment steps out for Cash on Delivery Orders", () => {
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
        for (const name of ["Cancel order", "Confirm", "Confirm order"]) {
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
  it("offers a placed Delivery Order Confirm and Reject, but no plain cancel", () => {
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null })} modules={ORDERS} />);

    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm order" })).toBeNull();
  });

  it("Reject needs a reason and sends it", async () => {
    vi.mocked(rejectOrder).mockResolvedValue({ ok: true, order: { id: 1042, status: "cancelled", deliveryFeeInCentavos: null } });
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null })} modules={ORDERS} />);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("alertdialog", { name: "Reject Order #1042?" });
    const submit = within(dialog).getByRole("button", { name: "Reject order" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "We cannot deliver there" } });
    fireEvent.click(submit);
    await waitFor(() => expect(rejectOrder).toHaveBeenCalledWith(1042, "We cannot deliver there"));
  });

  it("shows the Order's details in the Confirm dialog", () => {
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const dialog = screen.getByRole("alertdialog", { name: "Confirm Order #1042?" });
    expect(within(dialog).getByLabelText("Order details")).toBeTruthy();
    expect(within(dialog).getByLabelText(/Delivery fee to charge/)).toBeTruthy();
  });

  it("offers cancel up to preparing, and nothing to confirm once past placed", () => {
    for (const status of ["confirmed", "awaiting payment", "paid", "preparing"]) {
      const { unmount } = render(<OrderDetailView order={detail({ status })} modules={ORDERS} />);
      expect(actionButtons().map((b) => b.textContent)).toEqual(["Cancel order"]);
      unmount();
    }
  });

  it("never offers cancel once dispatched, and says so plainly", () => {
    render(<OrderDetailView order={detail({ status: "dispatched" })} modules={ORDERS} />);

    expect(actionButtons()).toHaveLength(0);
    expect(screen.getByText("A dispatched Order cannot be cancelled.")).toBeTruthy();
  });

  it("offers nothing on a delivered or cancelled Order", () => {
    for (const status of ["delivered", "cancelled"]) {
      const { unmount } = render(<OrderDetailView order={detail({ status })} modules={ORDERS} />);
      expect(actionButtons()).toHaveLength(0);
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

  it("locks the fee at ₱0 and shows Free delivery for a qualifying Order, with the total before confirming", async () => {
    vi.mocked(quoteDeliveryFee).mockResolvedValue(confirmed(1042, 0));
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null, total: 100_000, freeDelivery: { qualifies: true, thresholdInCentavos: 50_000 } })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm free delivery" }));

    const dialog = screen.getByRole("alertdialog", { name: "Confirm Order #1042?" });
    const fee = within(dialog).getByLabelText(/Delivery fee to charge/) as HTMLInputElement;
    expect(fee.value).toBe("0.00");
    expect(fee.disabled).toBe(true);
    expect(within(dialog).getByText(/Free delivery · the fee is locked/)).toBeTruthy();
    const total = within(dialog).getByRole("group", { name: "Order total" });
    expect(total.textContent).toContain("= Total₱1,000.00");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm order" }));
    expect(quoteDeliveryFee).toHaveBeenCalledWith(1042, 0, 100_000, undefined, undefined);
  });

  it("keeps the fee editable for a Delivery Order that does not qualify", () => {
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null, total: 100_000, freeDelivery: { qualifies: false, thresholdInCentavos: 200_000 } })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const dialog = screen.getByRole("alertdialog", { name: "Confirm Order #1042?" });
    const fee = within(dialog).getByLabelText(/Delivery fee to charge/) as HTMLInputElement;
    expect(fee.disabled).toBe(false);
    fireEvent.change(fee, { target: { value: "150" } });
    expect(within(dialog).getByRole("group", { name: "Order total" }).textContent).toContain("= Total₱1,150.00");
  });

  it("shows the Order page's loading state at once", async () => {
    const { default: Loading } = await import("@/app/(app)/orders/[id]/loading");
    render(<Loading />);
    expect(screen.getByRole("status", { name: "Loading Order" })).toBeTruthy();
  });

  it("shows no courier estimate fields; only the fee to charge", () => {
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null, total: 100_000 })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const dialog = screen.getByRole("alertdialog", { name: "Confirm Order #1042?" });
    expect(within(dialog).queryByLabelText("Lalamove estimate")).toBeNull();
    expect(within(dialog).queryByLabelText("Grab estimate")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/Delivery fee to charge/), { target: { value: "190" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm order" }));
    expect(quoteDeliveryFee).toHaveBeenCalledWith(1042, 19_000, 119_000, undefined, undefined);
  });

  it("lists only the Payment accounts for the Customer's method and sends the one chosen", () => {
    const order = { ...detail({ status: "placed", deliveryFee: null, total: 100_000 }), paymentAccounts: [{ id: "acc-1", label: "Shop GCash", accountName: "Bren R.", maskedNumber: "•••••••4321" }] };
    render(<OrderDetailView order={order} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const dialog = screen.getByRole("alertdialog", { name: "Confirm Order #1042?" });
    expect(within(dialog).getByRole("combobox", { name: "Payment account" })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Delivery fee to charge/), { target: { value: "190" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm order" }));
    expect(quoteDeliveryFee).toHaveBeenCalledWith(1042, 19_000, 119_000, undefined, "acc-1");
  });

  it("quotes a Delivery fee in pesos, sends centavos, and confirms once the server does", async () => {
    const pending = deferred<Awaited<ReturnType<typeof quoteDeliveryFee>>>();
    vi.mocked(quoteDeliveryFee).mockReturnValue(pending.promise);
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null, total: 100_000 })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    const dialog = screen.getByRole("alertdialog", { name: "Confirm Order #1042?" });
    const submit = within(dialog).getByRole("button", { name: "Confirm order" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText(/Delivery fee/), { target: { value: "150.50" } });
    expect(within(dialog).getByText("= Total").nextElementSibling?.textContent).toBe("₱1,150.50");
    fireEvent.click(submit);

    expect(quoteDeliveryFee).toHaveBeenCalledWith(1042, 15_050, 115_050, undefined, undefined);
    expect(within(dialog).getByRole("button", { name: "Confirming…" }).getAttribute("aria-busy")).toBe("true");
    expect(toast.success).not.toHaveBeenCalled();

    await act(async () => pending.settle(confirmed(1042, 15_050)));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Order #1042 confirmed with a ₱150.50 Delivery fee.");
  });

  it("sends the discounted total when quoting a Delivery fee", () => {
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null, discount: 5_000, total: 95_000 })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Delivery fee/), { target: { value: "0" } });
    expect(within(dialog).getByText("= Total").nextElementSibling?.textContent).toBe("₱950.00");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm order" }));
    expect(quoteDeliveryFee).toHaveBeenCalledWith(1042, 0, 95_000, undefined, undefined);
  });

  it("will not send a fee that is not an amount in pesos", () => {
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const dialog = screen.getByRole("alertdialog");

    // Letters and symbols never get into the field, so what is left is empty or a lone dot.
    for (const value of ["", ".", "abc", "-", "e"]) {
      fireEvent.change(within(dialog).getByLabelText(/Delivery fee/), { target: { value } });
      expect((within(dialog).getByLabelText(/Delivery fee/) as HTMLInputElement).value).toBe(value === "." ? "." : "");
      expect((within(dialog).getByRole("button", { name: "Confirm order" }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.change(within(dialog).getByLabelText(/Delivery fee/), { target: { value: "1.234e3" } });
    expect((within(dialog).getByLabelText(/Delivery fee/) as HTMLInputElement).value).toBe("1.23");
    expect(quoteDeliveryFee).not.toHaveBeenCalled();
  });

  it("shows a refused quote's reason and keeps the fee pending", async () => {
    vi.mocked(quoteDeliveryFee).mockResolvedValue({ ok: false, reason: "Storefront refused the change." });
    render(<OrderDetailView order={detail({ status: "placed", deliveryFee: null })} modules={ORDERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Delivery fee/), { target: { value: "150" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm order" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Storefront refused the change."));
    expect(screen.getAllByText("Delivery fee")[0].nextElementSibling?.textContent).toBe("Pending");
    expect(toast.success).not.toHaveBeenCalled();
  });

});

const PAYMENTS = ["Payments"];

const NOW = new Date("2026-10-19T13:02:00Z");

const queued = (overrides: Partial<PaymentRow> = {}): PaymentRow => ({
  proofRejectedAt: null,
  rejections: 0,
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

  it("tints a queued row pastel red when the proof reader found a mismatch, and leaves clean rows plain", () => {
    const read = { status: "read" as const, flags: { reusedReferenceOrderIds: [], reusedImageProofIds: [] }, corrections: [],
      findings: { amount: { finding: "Mismatch" as const, read: "90.00", expected: "₱900.00" } } as never };
    const { container } = renderPayments([queued({ id: 1, proofRead: read }), queued({ id: 2 })]);
    const [bad, ok] = Array.from(container.querySelectorAll("[data-payment-row]"));
    expect(bad.getAttribute("data-anomaly")).toBe("true");
    expect(ok.getAttribute("data-anomaly")).toBeNull();
  });

  it("opens the verify dialog with the proof beside the amount due, offering Mark paid and Cancel order", () => {
    renderPayments([queued()]);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));

    const dialog = screen.getByRole("dialog", { name: "Verify payment · Order #1046" });
    expect(within(dialog).getByText(/order total ₱1,197.00/)).toBeTruthy();
    expect(within(dialog).getByRole("img", { name: "Receipt for Order #1046" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Zoom Receipt for Order #1046" }));
    expect(within(dialog).queryByRole("button", { name: "View image" })).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(within(dialog).getByText(/Reading the screenshot never marks an Order paid/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Mark paid" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel order" })).toBeTruthy();
    expect(markPaid).not.toHaveBeenCalled();
  });

  it("asks before marking paid, then moves the Order to Paid at once, before the server answers", async () => {
    const pending = deferred<Awaited<ReturnType<typeof markPaid>>>();
    vi.mocked(markPaid).mockReturnValue(pending.promise);
    renderPayments([queued()]);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("checkbox"));
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
    fireEvent.click(screen.getByRole("checkbox"));
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

const reused = (checks: Partial<PaymentRow["proofChecks"] & object> = {}): PaymentRow["proofChecks"] => ({
  confirmed: { amountInCentavos: 119_700, paidAt: new Date("2026-10-19T12:50:00Z"), recipient: "09171234567" },
  expected: { amountInCentavos: 119_700, placedAt: new Date("2026-10-19T12:40:00Z"), recipient: "09171234567" },
  checks: {
    amount: { pass: true, reason: "Amount matches the Order total." },
    date: { pass: true, reason: "Payment date is after the Order was placed." },
    recipient: { pass: true, reason: "Recipient matches the shop account." },
    reference: { pass: false, reason: "Reference also used on Order #42.", otherOrderIds: [42] },
  },
  ...checks,
});

describe("the proof check dialog by Role", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Review" }));

  it("shows a reused reference with both Orders and no Mark paid", () => {
    render(<PaymentsView rows={[queued({ proofChecks: reused() })]} now={NOW} role="staff" />);
    open();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert").textContent).toContain("Order #42");
    expect(within(dialog).getAllByRole("link", { name: "Order #42" }).length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole("button", { name: "Mark paid" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Request approval…" })).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).getByRole("button", { name: "Request approval…" })).toHaveProperty("disabled", false);
  });

  it("gives a Manager Approve anyway instead", () => {
    render(<PaymentsView rows={[queued({ proofChecks: reused() })]} now={NOW} role="manager" />);
    open();
    fireEvent.click(screen.getByRole("checkbox"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Approve anyway" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Request approval…" })).toBeNull();
  });

  it("keeps Mark paid disabled until the GCash history is ticked, and never calls the server from reading alone", () => {
    render(<PaymentsView rows={[queued({ proofChecks: reused({ checks: { ...reused()!.checks, reference: { pass: true, reason: "Reference is not used on another Order.", otherOrderIds: [] } } }) })]} now={NOW} role="staff" />);
    open();
    expect(screen.getByRole("button", { name: "Mark paid" })).toHaveProperty("disabled", true);
    expect(markPaid).not.toHaveBeenCalled();
  });

  it.each(["admin", "ceo"] as const)("is view only for %s", (role) => {
    render(<PaymentsView rows={[queued({ proofChecks: reused() })]} now={NOW} role={role} />);
    open();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /Mark paid|Approve anyway|Request approval|Reject receipt|Cancel order/ })).toBeNull();
    expect(within(dialog).getByRole("checkbox")).toHaveProperty("disabled", true);
  });

  it("shows Waiting for approval to Staff whose request is pending", () => {
    render(<PaymentsView rows={[queued({ proofChecks: reused() })]} now={NOW} role="staff" approvals={{ 1046: { waiting: true } }} />);
    open();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(within(screen.getByRole("dialog")).getByText("Waiting for approval")).toBeTruthy();
  });
});

describe("the Payments Module's actions on an Order's detail", () => {
  const awaiting = (overrides: Partial<OrderDetail> = {}) =>
    detail({
      status: "awaiting payment",
      paymentProof: { reference: "1234567890", screenshot: null, submittedAt: new Date("2026-10-20T01:00:00Z"), rejectedAt: null },
      ...overrides,
    });

  it("offers Mark paid and Cancel order for a GCash Order awaiting payment, and nothing from the Orders Module", () => {
    render(<OrderDetailView order={awaiting()} modules={PAYMENTS} />);

    expect(actionButtons().map((b) => b.textContent)).toEqual(["Cancel order", "Reject receipt", "Ask for a new proof", "Mark paid"]);
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
      expect(actionButtons()).toHaveLength(0);
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

describe("Returns-only Order detail access", () => {
  it("shows Order context and a Returns back link without Orders, Payments or Fulfilment actions", () => {
    for (const status of ["placed", "confirmed", "awaiting payment", "paid", "preparing", "dispatched", "delivered"]) {
      const view = render(<OrderDetailView order={detail({ status })} modules={["Returns"]} />);
      expect(screen.getByRole("heading", { name: "Order #1042" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Returns" })).toBeTruthy();
      expect(actionButtons()).toHaveLength(0);
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
    expect(actionButtons().map(b => b.textContent)).toEqual(["Print packing slip"]);
  });
});

describe("payment proof history, reject, ask for a new proof and approve anyway", () => {
  const proof = (id: number, rejection: OrderDetail["paymentProofs"][number]["rejection"] = null) =>
    ({ id, reference: `REF${id}`, screenshot: null, submittedAt: new Date("2026-10-20T01:00:00Z"), rejection });
  const awaiting = (overrides: Partial<OrderDetail> = {}) =>
    detail({
      status: "awaiting payment",
      paymentProof: { reference: "REF1", screenshot: null, submittedAt: new Date("2026-10-20T01:00:00Z"), rejectedAt: null },
      ...overrides,
    });
  const capped = () => awaiting({
    proofRejections: 3,
    paymentProofs: [1, 2, 3].map((n) => proof(n, { at: new Date("2026-10-21T01:00:00Z"), by: { id: "a", name: "Ana" }, reason: `Blurry ${n}` })),
  });

  const reused = () => awaiting({
    paymentProofs: [{ ...proof(1, null), checks: { reference: { pass: false, reason: "Reference also used on Order #7.", otherOrderIds: [7] } } } as never],
  });

  it("a reused reference swaps Mark paid for Request approval (Staff) or Approve anyway (Manager)", () => {
    const staff = render(<OrderDetailView order={reused()} modules={PAYMENTS} role="staff" />);
    expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull();
    expect(screen.getByRole("button", { name: "Request approval…" })).toBeTruthy();
    staff.unmount();
    const manager = render(<OrderDetailView order={reused()} modules={PAYMENTS} role="manager" />);
    expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve anyway" })).toBeTruthy();
    manager.unmount();
    render(<OrderDetailView order={reused()} modules={PAYMENTS} role="ceo" />);
    expect(screen.queryByRole("button", { name: "Approve anyway" })).toBeNull();
  });

  it("a Manager on a reused reference names which Order the transfer pays", async () => {
    vi.mocked(markPaid).mockResolvedValue({ ok: false, reason: "Transfer allocated to Order #7. It does not pay this Order: reject the proof or ask for a new one." });
    render(<OrderDetailView order={reused()} modules={PAYMENTS} role="manager" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve anyway" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByLabelText("Order #1042 (this Order)")).toHaveProperty("checked", true);
    fireEvent.click(within(dialog).getByLabelText("Order #7"));
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "It belongs to the first order" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve anyway" }));

    await waitFor(() => expect(markPaid).toHaveBeenCalledWith(1042, { reason: "It belongs to the first order", approvalId: undefined, allocateToOrderId: 7 }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Transfer allocated to Order #7")));
  });

  it("lists every proof with who rejected it and why", () => {
    render(<OrderDetailView order={capped()} modules={PAYMENTS} role="manager" />);

    expect(screen.getByText("Proof 3")).toBeTruthy();
    expect(screen.getByText(/Rejected by Ana on .*Blurry 2/)).toBeTruthy();
    expect(screen.getByText(/only a Manager can approve/)).toBeTruthy();
  });

  it("rejects with a required reason, waits for the server, and rolls back with its reason", async () => {
    const pending = deferred<Awaited<ReturnType<typeof rejectPaymentProof>>>();
    vi.mocked(rejectPaymentProof).mockReturnValue(pending.promise);
    render(<OrderDetailView order={awaiting()} modules={PAYMENTS} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject receipt" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Reject receipt" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Blurry" } });
    fireEvent.click(confirm);

    expect(rejectPaymentProof).toHaveBeenCalledWith(1042, "Blurry");
    expect(within(dialog).getByRole("button", { name: "Rejecting…" })).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
    await act(async () => pending.settle({ ok: false, reason: "Order already changed; refresh it before trying again." }));
    expect(toast.error).toHaveBeenCalledWith("Order already changed; refresh it before trying again.");
  });

  it("asks for a new proof with the chosen reason and the note", async () => {
    vi.mocked(rejectPaymentProof).mockResolvedValue({ ok: true, order: { id: 1042, status: "awaiting payment", deliveryFeeInCentavos: null } });
    render(<OrderDetailView order={awaiting()} modules={PAYMENTS} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask for a new proof" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByLabelText("The amount does not match the Order"));
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Should be 1,197" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ask for a new proof" }));

    await waitFor(() => expect(rejectPaymentProof).toHaveBeenCalledWith(1042, "The amount does not match the Order. Should be 1,197"));
  });

  it("after 3 rejections a Manager approves anyway with a reason, and nothing else offers Mark paid", async () => {
    vi.mocked(markPaid).mockResolvedValue(paidResult(1042));
    render(<OrderDetailView order={capped()} modules={PAYMENTS} role="manager" />);
    expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject receipt" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve anyway" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Seen it in the bank app" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve anyway" }));

    await waitFor(() => expect(markPaid).toHaveBeenCalledWith(1042, { reason: "Seen it in the bank app", approvalId: undefined }));
  });

  it("shows Staff Request approval, which counts Waiting for approval as sent, not refused", async () => {
    vi.mocked(markPaid).mockResolvedValue({ ok: false, reason: "Waiting for approval" });
    render(<OrderDetailView order={capped()} modules={PAYMENTS} role="staff" />);
    expect(screen.queryByRole("button", { name: "Approve anyway" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Request approval…" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Customer called" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("lets Staff carry out an approved request, and shows Waiting while it is pending", () => {
    const { unmount } = render(<OrderDetailView order={capped()} modules={PAYMENTS} role="staff" approvalId="req-1" />);
    expect(screen.getByRole("button", { name: "Approve anyway" })).toBeTruthy();
    unmount();
    render(<OrderDetailView order={capped()} modules={PAYMENTS} role="staff" waitingApproval />);
    expect(screen.getByText("Waiting for approval")).toBeTruthy();
  });

  it("gives Admin and the CEO no payment buttons", () => {
    render(<OrderDetailView order={awaiting()} modules={PAYMENTS} role="ceo" />);
    expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull();
  });
});

describe("Email not sent notice", () => {
  const failed = (...extra: { kind: string; occurrence?: string | null; reason: string }[]) =>
    detail({ emailFailures: [{ kind: "confirmation", occurrence: null, reason: "mailbox full" }, ...extra.map((e) => ({ occurrence: null, ...e }))] as never });
  const ORDERS = ["Orders"];

  it("shows only on a failed outcome, with the reason", () => {
    render(<OrderDetailView order={detail({})} modules={ORDERS} role="staff" />);
    expect(screen.queryByTestId("email-not-sent")).toBeNull();
    cleanup();
    render(<OrderDetailView order={failed()} modules={ORDERS} role="staff" />);
    expect(within(screen.getByTestId("email-not-sent")).getByText(/mailbox full/)).toBeTruthy();
  });

  it("confirms first, then resends and reports success", async () => {
    vi.mocked(resendStatusEmail).mockResolvedValue({ ok: true });
    render(<OrderDetailView order={failed()} modules={ORDERS} role="manager" />);
    fireEvent.click(screen.getByRole("button", { name: "Resend confirmation email" }));
    expect(resendStatusEmail).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Resend email" }));
    await waitFor(() => expect(resendStatusEmail).toHaveBeenCalledWith(1042, "confirmation", null));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Confirmation email sent."));
  });

  it("says why when the server refuses", async () => {
    vi.mocked(resendStatusEmail).mockResolvedValue({ ok: false, reason: "Resend is not available right now." });
    render(<OrderDetailView order={failed()} modules={ORDERS} role="staff" />);
    fireEvent.click(screen.getByRole("button", { name: "Resend confirmation email" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resend email" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Resend is not available right now."));
  });

  it("shows each failed email with its own Resend, passing the occurrence", async () => {
    vi.mocked(resendStatusEmail).mockResolvedValue({ ok: true });
    const order = detail({ emailFailures: [
      { kind: "payment-rejected", occurrence: "1", reason: "first bounce" }, { kind: "payment-rejected", occurrence: "2", reason: "second bounce" },
    ] as never });
    render(<OrderDetailView order={order} modules={["Payments"]} role="staff" />);
    expect(screen.getByText(/first bounce/)).toBeTruthy();
    expect(screen.getByText(/second bounce/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Resend payment rejected email" })[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Resend email" }));
    await waitFor(() => expect(resendStatusEmail).toHaveBeenCalledWith(1042, "payment-rejected", "2"));
  });

  it("shows an email only to people holding its owning Module", () => {
    render(<OrderDetailView order={failed({ kind: "dispatched", reason: "bounced" })} modules={ORDERS} role="staff" />);
    expect(screen.getByRole("button", { name: "Resend confirmation email" })).toBeTruthy();
    expect(screen.queryByText(/bounced/)).toBeNull();
    cleanup();
    render(<OrderDetailView order={failed({ kind: "dispatched", reason: "bounced" })} modules={["Orders", "Fulfilment"]} role="staff" />);
    expect(screen.getByRole("button", { name: "Resend Out for delivery email" })).toBeTruthy();
  });

  it("is read-only for Admin and the CEO", () => {
    render(<OrderDetailView order={failed()} modules={ORDERS} role="admin" />);
    expect(screen.getByTestId("email-not-sent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend confirmation email" })).toBeNull();
  });
});

describe("the proof review panel", () => {
  const account = { method: "gcash", label: "Shop GCash", bankName: null, name: "Bren Raphael", number: "09171234567" };
  const review = (overrides: Partial<PaymentRow> = {}, role: "staff" | "manager" = "staff") => {
    render(<PaymentsView rows={[queued(overrides)]} now={NOW} role={role} />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    return screen.getByRole("dialog");
  };

  it("shows the saved account snapshot beside the proof", () => {
    const dialog = review({ proof: { ...queued().proof!, account } });
    const panel = within(dialog).getByRole("region", { name: "Account paid" });
    expect(within(panel).getByText("Shop GCash")).toBeTruthy();
    expect(within(panel).getByText("Bren Raphael")).toBeTruthy();
    expect(within(panel).getByText("09171234567")).toBeTruthy();
  });

  it("says so when the proof has no account", () => {
    const dialog = review();
    expect(within(dialog).getByText("The Customer did not pick an account with this proof.")).toBeTruthy();
  });

  it("badges a waiting proof Pending and reminds Staff to verify the real transfer", () => {
    const dialog = review();
    expect(dialog.querySelector("[data-proof-badge]")?.textContent).toBe("Pending");
    expect(within(dialog).getByRole("note").textContent).toContain("Verify the real transfer with the payment provider");
  });
});

describe("the proof badge", () => {
  it("is Verified once the Order is past awaiting payment, Rejected when turned down, Pending otherwise", () => {
    expect(proofOutcome({ rejected: false }, "paid")).toBe("Verified");
    expect(proofOutcome({ rejected: true }, "awaiting payment")).toBe("Rejected");
    expect(proofOutcome({ rejected: false }, "awaiting payment")).toBe("Pending");
  });
});
