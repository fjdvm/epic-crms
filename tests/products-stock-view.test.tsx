// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/orders/actions", () => ({
  quoteDeliveryFee: vi.fn(), confirmPickup: vi.fn(), cancelOrder: vi.fn(), cancelPaymentOrder: vi.fn(), markPaid: vi.fn(),
}));

import { OrderDetailView } from "@/features/orders/order-detail";
import type { OrderDetail } from "@/features/orders/orders";
import { type StockPage } from "@/features/orders/stock";
import { StockView } from "@/features/orders/stock-view";

afterEach(cleanup);

const row = (sizeId: number, product: string, available: number | null, shows: StockPage["rows"][number]["shows"]) =>
  ({ sizeId, product, size: "250 g", inStock: available, reserved: available === null ? null : 2, available, shows });
const page: StockPage = {
  imsReachable: true,
  summary: { sizes: 3, soldOut: 1, reserved: 6, low: 1 },
  rows: [row(1, "Plenty", 40, "In stock"), row(2, "Few", 7, { left: 7 }), row(3, "None", 0, "Sold out")],
};

it("lists quantities and filters to low stock and sold out without leaving the page", () => {
  render(<StockView page={page} />);
  expect(screen.getAllByText(/·/).length).toBeGreaterThan(0);
  expect(screen.getByText("Only 7 left")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: /Low stock/ }));
  expect(document.querySelectorAll("[data-stock-row]")).toHaveLength(1);
  fireEvent.click(screen.getByRole("tab", { name: /Sold out/ }));
  expect(within(document.querySelector("[data-stock-row]") as HTMLElement).getByText("None · 250 g")).toBeTruthy();
});

it("says so when the IMS cannot be read and implies no polling", () => {
  render(<StockView page={{ ...page, imsReachable: false }} />);
  expect(screen.getByRole("alert").textContent).toContain("could not be reached");
  expect(document.body.textContent).not.toMatch(/updated .* ago/i);
});

it("shows each Order line's reserved quantity", () => {
  const order = {
    id: 1, createdAt: new Date(), status: "confirmed", fulfillmentMethod: "pickup", paymentMethod: "cash-on-delivery",
    lines: [{ id: 11, product: "Halaya", size: "500g", quantity: 4, price: 50_000 }], subtotal: 200_000, deliveryFee: null,
    total: 200_000, address: null, feedback: null, paymentProof: null, paymentLabel: "Unpaid",
    customer: { id: "c1", name: "Maria" }, paidBy: null, packedBy: null, deliveryPhotoFileId: null, deliveryPhotoRemovedAt: null,
  } as unknown as OrderDetail;
  render(<OrderDetailView order={order} modules={["Orders"]} reservations={new Map([[11, { reserved: 4, left: 18 }]])} />);
  expect(screen.getByText(/Reserved 4 · 18 left/)).toBeTruthy();
});
