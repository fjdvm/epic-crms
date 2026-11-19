// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentAccountCard } from "@/features/management/payment-account-card";
import type { PaymentAccountRow } from "@/features/management/payment-accounts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/management/payment-actions", () => ({
  changePaymentAccountQr: vi.fn(), removePaymentAccount: vi.fn(), switchPaymentAccount: vi.fn(), switchPaymentMethod: vi.fn(), updatePaymentAccount: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

afterEach(cleanup);

const account: PaymentAccountRow = { id: "a1", method: "gcash", label: "GcashPayment", accountName: "Maredette M.", maskedNumber: "•••••••7289", bankName: null, active: true, hasQr: true, used: false, accountNumber: "09171237289" };

describe("PaymentAccountCard", () => {
  it("starts collapsed: title, status and one-line summary, no actions", () => {
    render(<PaymentAccountCard account={account} />);
    expect(screen.getByText("GcashPayment")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText(/Maredette M\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show details for GcashPayment" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("expands to detail tiles and the actions, and collapses again", () => {
    render(<PaymentAccountCard account={account} />);
    fireEvent.click(screen.getByRole("button", { name: "Show details for GcashPayment" }));
    expect(screen.getByText("Method")).toBeTruthy();
    expect(screen.getByText("Account name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch off" })).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Hide details for GcashPayment" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
