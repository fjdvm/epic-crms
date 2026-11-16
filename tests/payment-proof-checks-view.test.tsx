// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

afterEach(cleanup);
import { PaymentProofChecksView } from "@/features/orders/payment-proof-checks-view";
import type { PaymentProofChecks } from "@/features/orders/payment-proof-checks";

const base: PaymentProofChecks = {
  confirmed: { amountInCentavos: 12000, paidAt: new Date("2026-01-02T00:00:00Z"), recipient: "09171234567" },
  expected: { amountInCentavos: 12500, placedAt: new Date("2026-01-01T00:00:00Z"), recipient: "09179999999" },
  checks: {
    amount: { pass: false, reason: "Amount does not match the Order total." },
    date: { pass: true, reason: "Payment date is after the Order was placed." },
    recipient: { pass: false, reason: "Recipient does not match the shop account." },
    reference: { pass: false, reason: "Reference also used on Order #42.", otherOrderIds: [42] },
  },
};
const row = (name: string) => screen.getByRole("rowheader", { name }).closest("tr") as HTMLElement;

it("shows confirmed beside expected for each field, with Pass or Fail and its reason", () => {
  render(<PaymentProofChecksView {...base} reference="5012334812" />);
  expect(within(row("Amount")).getByText("₱120.00")).toBeTruthy();
  expect(within(row("Amount")).getByText("₱125.00")).toBeTruthy();
  expect(within(row("Amount")).getByText("Fail")).toBeTruthy();
  expect(within(row("Amount")).getByText(/does not match the Order total/)).toBeTruthy();
  expect(within(row("Date & time (Philippine time)")).getByText("Pass")).toBeTruthy();
  expect(within(row("Sent to")).getByText("09171234567")).toBeTruthy();
  expect(within(row("Sent to")).getByText("09179999999")).toBeTruthy();
  expect(within(row("Reference no.")).getByText("5012334812")).toBeTruthy();
});

it("links the Orders that already used the reference, and says reading never marks paid", () => {
  render(<PaymentProofChecksView {...base} />);
  expect(screen.getByRole("link", { name: "Order #42" }).getAttribute("href")).toBe("/orders/42");
  expect(screen.getByText(/never mark paid or reject/)).toBeTruthy();
});

it("shows every check passing and missing values as not provided", () => {
  render(<PaymentProofChecksView
    confirmed={{ amountInCentavos: null, paidAt: null, recipient: null }}
    expected={{ ...base.expected, recipient: null }}
    checks={{
      amount: { pass: false, reason: "Customer-confirmed amount is missing." },
      date: { pass: false, reason: "Customer-confirmed payment date is missing." },
      recipient: { pass: false, reason: "Customer-confirmed recipient is missing." },
      reference: { pass: true, reason: "Reference is not used on another Order.", otherOrderIds: [] },
    }} reference="1" />);
  expect(within(row("Amount")).getByText("Not provided")).toBeTruthy();
  expect(within(row("Sent to")).getByText("Not available")).toBeTruthy();
  expect(within(row("Reference no.")).getByText("Pass")).toBeTruthy();
  expect(screen.queryByText("Compare:")).toBeNull();
});
