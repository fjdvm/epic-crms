// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PaymentsView } from "@/features/orders/payment-queue";
import { summarize, type PaymentRow } from "@/features/orders/payments";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/orders/actions", () => ({ markPaid: vi.fn(), cancelPaymentOrder: vi.fn(), rejectPaymentProof: vi.fn() }));
vi.mock("@/features/orders/payment-review-actions", () => ({ claimPaymentReview: vi.fn(), loadReviewManagers: vi.fn(), reassignPaymentReview: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(cleanup);

const NOW = new Date("2026-11-22T00:00:00Z");
const flags = { reusedReferenceOrderIds: [], reusedImageProofIds: [] };
const f = (finding: "Match" | "Mismatch") => ({ finding, read: "x", expected: "y" });
const row = (id: number, amount: "Match" | "Mismatch"): PaymentRow => ({
  id, customer: { id: "c", name: `Customer ${id}` }, method: "gcash", status: "awaiting payment", total: 45_300,
  proof: { reference: "123", screenshot: null, submittedAt: new Date(NOW.getTime() - 3_600_000) }, proofRejectedAt: null, rejections: 0,
  proofRead: { status: "read", flags, corrections: [], findings: { amount: f(amount), date: f("Match"), reference: f("Match"), recipient: f("Match"), accountNumber: f("Match") } },
});

it("lists only flagged proofs on the Anomalies tab and keeps them in For verification", () => {
  const { tabs } = summarize([row(1, "Match"), row(2, "Mismatch")], NOW);
  expect(tabs.verify.map(r => r.id)).toEqual([1, 2]);
  expect(tabs.anomalies.map(r => r.id)).toEqual([2]);
});

it("shows the Anomalies tab with its count and an Anomaly badge on the row that opens the same review", () => {
  render(<PaymentsView rows={[row(1, "Match"), row(2, "Mismatch")]} now={NOW} role="staff" />);
  fireEvent.click(screen.getByRole("tab", { name: /Anomalies 1/ }));
  const rows = document.querySelectorAll("[data-payment-row]");
  expect(rows).toHaveLength(1);
  expect(rows[0].getAttribute("data-anomaly")).toBe("true");
  expect(rows[0].className).not.toMatch(/fdecec/);
  expect(screen.getByText("Anomaly")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Review/ })).toBeTruthy();
});

it("says so when nothing looks wrong", () => {
  render(<PaymentsView rows={[row(1, "Match")]} now={NOW} role="staff" />);
  fireEvent.click(screen.getByRole("tab", { name: /Anomalies 0/ }));
  expect(screen.getByText(/No payment proofs look wrong/)).toBeTruthy();
});
