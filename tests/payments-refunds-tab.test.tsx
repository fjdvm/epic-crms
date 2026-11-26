// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PaymentsView } from "@/features/orders/payment-queue";
import type { RefundRow } from "@/features/orders/refunds";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/orders/actions", () => ({ markPaid: vi.fn(), cancelPaymentOrder: vi.fn(), rejectPaymentProof: vi.fn() }));
vi.mock("@/features/orders/payment-review-actions", () => ({ claimPaymentReview: vi.fn(), loadReviewManagers: vi.fn(), reassignPaymentReview: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(cleanup);

const NOW = new Date("2026-11-22T00:00:00Z");
const refund: RefundRow = { returnId: 15, number: "RMA-15", orderId: 7, customer: "Maria Santos", amountInCentavos: 120_000,
  method: "gcash", reference: "GC-9981", settledBy: "Mario Cruz", refundedAt: new Date("2026-11-20T03:00:00Z") };

it("records each settled refund on its own tab, opening at once from what the page already loaded", () => {
  render(<PaymentsView rows={[]} now={NOW} refunds={[refund]} canOpenReturns />);
  const tab = screen.getByRole("tab", { name: "Refunds 1" });
  fireEvent.click(tab);
  expect(tab.getAttribute("aria-selected")).toBe("true");
  const row = within(screen.getByRole("table", { name: "Refunds" })).getAllByRole("row")[1];
  for (const text of ["Maria Santos", "₱1,200.00", "GCash", "GC-9981", "Mario Cruz"]) expect(within(row).getByText(text)).toBeTruthy();
  expect(within(row).getByRole("link", { name: "RMA-15" }).getAttribute("href")).toBe("/returns/15");
  expect(within(row).getByRole("link", { name: "#7" }).getAttribute("href")).toBe("/orders/7");
  // Read-only: the only buttons naming a refund are the column sort headings.
  expect(
    screen.queryAllByRole("button", { name: /refund/i }).filter((b) => !/^Sort by |, sorted /.test(b.getAttribute("aria-label") ?? "")),
  ).toHaveLength(0);
});

it("names the Return without a link for Staff who cannot open Returns, and says when there are none or they could not be read", () => {
  const { unmount } = render(<PaymentsView rows={[]} now={NOW} refunds={[refund]} />);
  fireEvent.click(screen.getByRole("tab", { name: "Refunds 1" }));
  expect(screen.getByText("RMA-15").closest("a")).toBeNull();
  // Without the Returns page, the row opens the Order instead.
  expect(screen.getByRole("link", { name: "#7" }).className).toContain("after:inset-0");
  unmount();
  const empty = render(<PaymentsView rows={[]} now={NOW} refunds={[]} />);
  fireEvent.click(screen.getByRole("tab", { name: "Refunds 0" }));
  expect(screen.getByText("No refunds in the last 30 days.")).toBeTruthy();
  empty.unmount();
  render(<PaymentsView rows={[]} now={NOW} refunds={null} />);
  fireEvent.click(screen.getByRole("tab", { name: "Refunds –" }));
  expect(screen.getByText("Refunds could not be loaded. Reload to try again.")).toBeTruthy();
});
