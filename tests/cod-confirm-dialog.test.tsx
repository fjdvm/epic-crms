// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { quoteDeliveryFee } from "@/features/orders/actions";
import { recordAskGcashFirst } from "@/features/orders/cod-actions";
import { OrderListView } from "@/features/orders/order-list";
import { OrdersActions } from "@/features/orders/orders-actions";
import type { OrderDetail, OrderList } from "@/features/orders/orders";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/orders/actions", () => ({ quoteDeliveryFee: vi.fn(), cancelOrder: vi.fn(), rejectOrder: vi.fn() }));
vi.mock("@/features/orders/cod-actions", () => ({ recordAskGcashFirst: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const order = { id: 1058, status: "placed", fulfillmentMethod: "delivery", deliveryFee: null, subtotal: 219000, discount: 0, customer: { id: "c1", name: "Jane Cruz" }, lines: [{ product: "Ube Halaya", size: "250g", quantity: 2, price: 109500 }], address: null } as unknown as OrderDetail;
const flags = [
  { rule: "first-order", label: "First order", reason: "No earlier Orders on this account" },
  { rule: "first-order-over-amount", label: "First order over the set amount", reason: "A first Order over the amount an Admin set" },
];

/** Opens the quote dialog and types the fee Staff would charge. */
function openQuote() {
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  fireEvent.change(screen.getByLabelText(/Delivery fee to charge/), { target: { value: "150" } });
}

describe("COD confirm dialog", () => {
  it("shows which rule fired, no scores, and needs a choice before saving", () => {
    render(<OrdersActions order={order} codFlags={flags} />);
    openQuote();
    const panel = screen.getByTestId("cod-confirm");
    expect(panel.textContent).toContain("First order over the set amount");
    expect(panel.textContent).toContain("No earlier Orders on this account");
    expect(panel.textContent).not.toMatch(/%|score|risk/i);
    expect(screen.getByRole("button", { name: "Save & continue" })).toHaveProperty("disabled", true);
  });

  it("confirms with the chosen option", async () => {
    vi.mocked(quoteDeliveryFee).mockResolvedValue({ ok: true, order: { id: 1058, status: "confirmed", deliveryFeeInCentavos: 15000 } });
    render(<OrdersActions order={order} codFlags={flags} />);
    openQuote();
    fireEvent.click(screen.getByLabelText("Call to confirm, then confirm the order"));
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(quoteDeliveryFee).toHaveBeenCalledWith(1058, 15000, 234000, "call-first", undefined));
    expect(toast.success).toHaveBeenCalledWith("Order #1058 confirmed with a ₱150.00 Delivery fee.");
  });

  it("asking for GCash first logs the choice and does not confirm", async () => {
    vi.mocked(recordAskGcashFirst).mockResolvedValue({ ok: true });
    render(<OrdersActions order={order} codFlags={flags} />);
    openQuote();
    fireEvent.click(screen.getByLabelText("Ask the customer to pay by GCash first"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(recordAskGcashFirst).toHaveBeenCalledWith(1058));
    expect(quoteDeliveryFee).not.toHaveBeenCalled();
  });

  it("says why when the server refuses", async () => {
    vi.mocked(quoteDeliveryFee).mockResolvedValue({ ok: false, reason: "Order already changed; refresh it before trying again." });
    render(<OrdersActions order={order} codFlags={flags} />);
    openQuote();
    fireEvent.click(screen.getByLabelText("Confirm as is"));
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Order already changed; refresh it before trying again."));
  });

  it("shows no flags panel for an unflagged Order", () => {
    render(<OrdersActions order={order} />);
    openQuote();
    expect(screen.queryByTestId("cod-confirm")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm order", hidden: false })).toBeTruthy();
  });
});

describe("Orders list COD flags", () => {
  const list = { rows: [
    { id: 1, createdAt: new Date("2026-10-20"), customerId: "c", customerName: "A", lines: [], total: 1000, status: "placed", paymentLabel: "Unpaid" },
    { id: 2, createdAt: new Date("2026-10-20"), customerId: "c", customerName: "B", lines: [], total: 1000, status: "placed", paymentLabel: "Unpaid" },
  ], counts: { all: 2 }, page: 1, pageSize: 20, totalPages: 1 } as unknown as OrderList;

  it("names the rule on flagged rows only, with no percentage", () => {
    render(<OrderListView list={list} params={{ tab: "all", page: 1 }} codFlags={{ 1: [{ rule: "first-order", label: "First order" }] }} />);
    expect(screen.getByTestId("cod-flags-1").textContent).toBe("First order");
    expect(screen.queryByTestId("cod-flags-2")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d%|score|stuck/i);
  });
});
