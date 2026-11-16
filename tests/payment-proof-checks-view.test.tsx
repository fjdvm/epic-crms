// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PaymentProofChecksView } from "@/features/orders/payment-proof-checks-view";

it("shows confirmed and expected values, each decision reason, and links to reused Orders", () => {
  render(<PaymentProofChecksView
    confirmed={{ amountInCentavos: 12000, paidAt: new Date("2026-01-02T00:00:00Z"), recipient: "09171234567" }}
    expected={{ amountInCentavos: 12500, placedAt: new Date("2026-01-01T00:00:00Z"), recipient: "09179999999" }}
    checks={{
      amount: { pass: false, reason: "Amount does not match the Order total." },
      date: { pass: true, reason: "Payment date is after the Order was placed." },
      recipient: { pass: false, reason: "Recipient does not match the shop account." },
      reference: { pass: false, reason: "Reference also used on Order #42.", otherOrderIds: [42] },
    }}
  />);
  expect(screen.getByText(/₱120.00 · expected ₱125.00/)).toBeTruthy();
  expect(screen.getByText(/09171234567 · shop account 09179999999/)).toBeTruthy();
  expect(screen.getByText(/Amount does not match/)).toBeTruthy();
  expect(screen.getByText(/Payment date is after/).textContent).toContain("Pass");
  expect(screen.getByRole("link", { name: "Order #42" }).getAttribute("href")).toBe("/orders/42");
  expect(screen.getByText(/These checks never mark paid or reject/)).toBeTruthy();
});
