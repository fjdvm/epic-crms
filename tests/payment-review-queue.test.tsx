// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentsView } from "@/features/orders/payment-queue";
import { summarize, type PaymentRow } from "@/features/orders/payments";
import { claimPaymentReview } from "@/features/orders/payment-review-actions";
import Loading from "@/app/(app)/payments/loading";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/orders/actions", () => ({ markPaid: vi.fn(), cancelPaymentOrder: vi.fn(), rejectPaymentProof: vi.fn() }));
vi.mock("@/features/orders/payment-review-actions", () => ({ claimPaymentReview: vi.fn(), loadReviewManagers: vi.fn(), reassignPaymentReview: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const NOW = new Date("2026-10-19T13:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const inReview = (id: number, startedHoursAgo: number, overdue: boolean, owner: { id: string; name: string } | null = null): PaymentRow => ({
  id, customer: { id: "c", name: `Customer ${id}` }, method: "gcash", status: "awaiting payment", total: 100_000,
  proof: { reference: "123", screenshot: null, submittedAt: hoursAgo(startedHoursAgo + 1) },
  proofRejectedAt: hoursAgo(startedHoursAgo), rejections: 3,
  review: { startedAt: hoursAgo(startedHoursAgo), deadline: hoursAgo(startedHoursAgo - 48), overdue, owner },
});

const openReviewTab = () => fireEvent.click(screen.getByRole("tab", { name: /Manager review/ }));

describe("the Manager review list", () => {
  it("sorts Overdue reviews first, then the longest waiting, and keeps them out of Rejected", () => {
    const rows = [inReview(1, 10, false), inReview(2, 60, true), inReview(3, 30, false), inReview(4, 50, true)];
    const { tabs } = summarize(rows, NOW);
    expect(tabs.review.map(r => r.id)).toEqual([2, 4, 3, 1]);
    expect(tabs.rejected).toEqual([]);
  });

  it("marks Overdue reviews and shows each owner", () => {
    render(<PaymentsView rows={[inReview(1, 60, true, { id: "marta", name: "Marta" }), inReview(2, 5, false)]} now={NOW} role="manager" />);
    openReviewTab();
    const rows = document.querySelectorAll("[data-payment-row]");
    expect(within(rows[0] as HTMLElement).getByText("Overdue")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("Owner: Marta")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByText("Overdue")).toBeNull();
    expect(within(rows[1] as HTMLElement).getByText("Not claimed")).toBeTruthy();
  });

  it("opens the Order from anywhere on its row, with the row's own actions kept above it", () => {
    render(<PaymentsView rows={[inReview(1, 5, false)]} now={NOW} role="manager" />);
    openReviewTab();
    const r = document.querySelector("[data-payment-row]") as HTMLElement;
    const open = within(r).getByRole("link", { name: "#1" });
    expect(open.getAttribute("href")).toBe("/orders/1");
    expect(open.className).toContain("after:inset-0");
    expect(within(r).getByRole("button", { name: "Claim review" }).closest(".z-10")).toBeTruthy();
  });

  it("offers Claim review to a Manager only, and only while unclaimed", () => {
    const { unmount } = render(<PaymentsView rows={[inReview(1, 5, false), inReview(2, 6, false, { id: "m", name: "Marta" })]} now={NOW} role="manager" />);
    openReviewTab();
    expect(screen.getAllByRole("button", { name: "Claim review" })).toHaveLength(1);
    unmount();
    for (const role of ["staff", "admin"] as const) {
      const view = render(<PaymentsView rows={[inReview(1, 5, false)]} now={NOW} role={role} />);
      openReviewTab();
      expect(screen.queryByRole("button", { name: "Claim review" })).toBeNull();
      view.unmount();
    }
  });

  it("confirms first, shows a spinner while the server answers, and says why when it refuses", async () => {
    let settle!: (r: { ok: false; reason: string }) => void;
    vi.mocked(claimPaymentReview).mockReturnValue(new Promise(r => { settle = r; }));
    render(<PaymentsView rows={[inReview(1, 5, false)]} now={NOW} role="manager" />);
    openReviewTab();
    fireEvent.click(screen.getByRole("button", { name: "Claim review" }));
    expect(claimPaymentReview).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Claim review" }));
    expect(claimPaymentReview).toHaveBeenCalledWith(1);
    expect(await screen.findByText("Claiming…")).toBeTruthy();
    settle({ ok: false, reason: "Marta already has this review." });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Marta already has this review."));
  });
});

describe("the Payments loading state", () => {
  it("shows the Manager review tab at once", () => {
    render(<Loading />);
    expect(screen.getByRole("status", { name: "Loading payments" }).textContent).toContain("Manager review");
  });
});
