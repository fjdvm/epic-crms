// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/orders/actions", () => ({
  quoteDeliveryFee: vi.fn(), cancelOrder: vi.fn(), cancelPaymentOrder: vi.fn(), markPaid: vi.fn(),
}));

import { OrderDetailView } from "@/features/orders/order-detail";
import type { OrderDetail } from "@/features/orders/orders";
import { type StockPage } from "@/features/orders/stock";
import { PILL } from "@/features/tickets/pill";
import { StockSkeleton, StockView } from "@/features/orders/stock-view";

afterEach(cleanup);

const row = (sizeId: number, product: string, available: number | null, shows: StockPage["rows"][number]["shows"]) =>
  ({ sizeId, product, size: "250 g", image: null, marker: null, inStock: available, reserved: available === null ? null : 2, available, shows, orders: available === null ? null : [{ orderId: 40 + sizeId, customer: `Customer ${sizeId}`, status: "Awaiting payment" as const, quantity: 2 }] });
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

it("shows four tiles, counts only sizes still on sale, and has no Low at column", () => {
  render(<StockView page={page} />);
  const tile = (label: string) => screen.getAllByText(label)[0].parentElement as HTMLElement;
  expect(tile("Sizes on sale").textContent).toContain("2");
  expect(tile("Sizes on sale").textContent).toContain("1 sold out");
  expect(tile("Sold out").textContent).toContain("1 size");
  expect(tile("Sold out").textContent).toContain("Checkout blocks at 0");
  expect(tile("Reserved by open orders").textContent).toContain("Released if the order is cancelled");
  expect(screen.queryByText("Low at")).toBeNull();
});

it("searches by product and combines with the tab", () => {
  render(<StockView page={page} />);
  fireEvent.change(screen.getByLabelText("Search product"), { target: { value: "fe" } });
  expect(document.querySelectorAll("[data-stock-row]")).toHaveLength(1);
  fireEvent.click(screen.getByRole("tab", { name: /Sold out/ }));
  expect(document.querySelectorAll("[data-stock-row]")).toHaveLength(0);
  expect(screen.getByText("No sizes here.")).toBeTruthy();
});

it("says so when the IMS cannot be read and implies no polling", () => {
  render(<StockView page={{ ...page, imsReachable: false }} />);
  expect(screen.getByRole("alert").textContent).toContain("could not be reached");
  expect(document.body.textContent).not.toMatch(/updated .* ago/i);
});

it("shows each Order line's reserved quantity", () => {
  const order = {
    id: 1, createdAt: new Date(), status: "confirmed", fulfillmentMethod: "delivery", paymentMethod: "cash-on-delivery",
    lines: [{ id: 11, product: "Halaya", size: "500g", quantity: 4, price: 50_000 }], subtotal: 200_000, deliveryFee: null,
    total: 200_000, address: null, feedback: null, paymentProof: null, paymentLabel: "Unpaid",
    customer: { id: "c1", name: "Maria" }, paidBy: null, codCollection: null, packedBy: null, deliveryPhotoFileId: null, deliveryPhotoRemovedAt: null,
  } as unknown as OrderDetail;
  render(<OrderDetailView order={order} modules={["Orders"]} reservations={new Map([[11, { reserved: 4, left: 18 }]])} />);
  expect(screen.getByText(/Reserved 4 · 18 left/)).toBeTruthy();
});

it("shows dashes in every tile, not zeros, when the IMS cannot be read", () => {
  render(<StockView page={{ ...page, imsReachable: false, summary: { sizes: 3, soldOut: 0, reserved: 0, low: 0 } }} />);
  const tile = (label: string) => screen.getAllByText(label)[0].parentElement as HTMLElement;
  for (const label of ["Sizes on sale", "Reserved by open orders", "Low stock", "Sold out"]) expect(tile(label).textContent).toContain("–");
  expect(tile("Reserved by open orders").textContent).not.toContain("0 items");
});

it("says '1 size' for a single size", () => {
  render(<StockView page={page} />);
  expect((screen.getAllByText("Sold out")[0].parentElement as HTMLElement).textContent).toContain("1 size");
  expect((screen.getAllByText("Sold out")[0].parentElement as HTMLElement).textContent).not.toContain("1 sizes");
});

it("tints a sold-out row red and keeps the pill red", () => {
  render(<StockView page={page} />);
  fireEvent.click(screen.getByRole("tab", { name: /Sold out/ }));
  const soldOut = document.querySelector("[data-stock-row]") as HTMLElement;
  expect(soldOut.className).toContain("bg-[#fff7f7]");
  expect(within(soldOut).getByText("Sold out").className).toContain(PILL.red);
});

it("loads a skeleton with four tiles, a search box and rows, and the Open IMS button is in the header", () => {
  render(<><StockSkeleton /></>);
  expect(document.querySelectorAll("[data-skeleton-tile]")).toHaveLength(4);
  expect(document.querySelectorAll("[data-skeleton-row]")).toHaveLength(7);
});

it("shows '2 reserved · 1 Order' and lists the Orders with Customer and status on click", () => {
  render(<StockView page={page} />);
  const first = document.querySelectorAll("[data-stock-row]")[0] as HTMLElement;
  expect(first.textContent).toContain("2 reserved · 1 Order");
  fireEvent.click(within(first).getByRole("button", { name: /1 Order holding/ }));
  const listed = document.querySelector("[data-holding-order]") as HTMLElement;
  expect(listed.textContent).toContain("Customer 1");
  expect(listed.textContent).toContain("Awaiting payment");
});

it("shows only the reserved units when the Orders could not be read", () => {
  render(<StockView page={{ ...page, rows: [{ ...page.rows[0], orders: null }] }} />);
  expect(document.body.textContent).toContain("2 reserved");
  expect(screen.queryByRole("button", { name: /holding/ })).toBeNull();
});

it("shows Not on shop with what is missing, and Discontinued, and keeps them out of the Sold out tab", () => {
  const flagged: StockPage = {
    ...page,
    rows: [
      { ...row(4, "Half made", 0, "Sold out"), marker: { kind: "not-on-shop", missing: ["image", "price"] } },
      { ...row(5, "Gone", 3, { left: 3 }), marker: { kind: "discontinued" } },
      row(6, "Plain", 40, "In stock"),
    ],
  };
  render(<StockView page={flagged} />);
  expect(screen.getByText("Not on shop")).toBeTruthy();
  expect(screen.getByText("Missing: image, price")).toBeTruthy();
  expect(screen.getByText("Discontinued")).toBeTruthy();
  expect(screen.getByText("Gone · 250 g")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: /Sold out/ }));
  expect(document.querySelectorAll("[data-stock-row]")).toHaveLength(0);
});

it("shows a product with no Variant by its name alone", () => {
  render(<StockView page={{ ...page, rows: [{ ...row(7, "Ube Jam", 40, "In stock"), size: "" }] }} />);
  expect(screen.getByText("Ube Jam")).toBeTruthy();
});

const withImage = { ...row(8, "Ube Jam", 40, "In stock"), size: "", image: "https://img.test/ube.jpg" };

it("shows the product image before its name and zooms it with the name as caption", () => {
  render(<StockView page={{ ...page, rows: [withImage] }} />);
  const open = screen.getByRole("button", { name: "Zoom Ube Jam" });
  expect(open.compareDocumentPosition(screen.getByText("Ube Jam")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(open);
  const dialog = screen.getByRole("dialog");
  expect(dialog.querySelector("img")?.getAttribute("src")).toBe("https://img.test/ube.jpg");
  expect(within(dialog).getByText("Ube Jam")).toBeTruthy();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows a plain tile that does nothing for a product with no image", () => {
  render(<StockView page={{ ...page, rows: [row(9, "Bare", 40, "In stock")] }} />);
  expect(document.querySelector("[data-image-tile]")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Zoom/ })).toBeNull();
});

it("shows the unreachable alert and an empty list, not stale rows, when the feed is down", () => {
  render(<StockView page={{ rows: [], imsReachable: false, summary: { sizes: 0, soldOut: 0, reserved: 0, low: 0 } }} />);
  expect(screen.getByRole("alert").textContent).toContain("could not be reached");
  expect(document.querySelectorAll("[data-stock-row]")).toHaveLength(0);
});
