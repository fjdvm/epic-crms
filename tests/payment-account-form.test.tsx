// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentAccountForm } from "@/features/management/payment-account-form";
import { createPaymentAccount } from "@/features/management/payment-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/management/payment-actions", () => ({ createPaymentAccount: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const fill = () => {
  fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Main GCash" } });
  fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Bren Raphael" } });
  fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "0917 123 4567" } });
};
const openModal = () => fireEvent.click(screen.getByRole("button", { name: "Add payment account" }));
const open = () => fireEvent.click(screen.getByRole("button", { name: "Add account" }));
const confirm = () => fireEvent.click(screen.getAllByRole("button", { name: "Add account" }).at(-1)!);

describe("PaymentAccountForm", () => {
  it("shows only a button until it is pressed, then the fields in a modal", () => {
    render(<PaymentAccountForm />);
    expect(screen.queryByLabelText("Label")).toBeNull();
    openModal();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("Label")).toBeTruthy();
  });

  it("shows a plain-word error for a bad number and cannot be confirmed", () => {
    render(<PaymentAccountForm />);
    openModal();
    fill();
    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "123" } });
    expect(screen.getByRole("alert").textContent).toMatch(/mobile number/);
    open();
    expect(screen.getAllByRole("button", { name: "Add account" }).at(-1)).toHaveProperty("disabled", true);
    expect(createPaymentAccount).not.toHaveBeenCalled();
  });

  it("shows method, name and masked number in the confirm dialog, then spins and is not optimistic", async () => {
    let finish!: (v: { ok: true }) => void;
    vi.mocked(createPaymentAccount).mockReturnValue(new Promise((r) => { finish = r; }));
    render(<PaymentAccountForm />);
    openModal();
    fill();
    open();
    const dialog = within(screen.getByRole("alertdialog"));
    expect(dialog.getByText("GCash")).toBeTruthy();
    expect(dialog.getByText("•••••••4567")).toBeTruthy();
    expect(screen.queryByText("09171234567")).toBeNull();
    expect(createPaymentAccount).not.toHaveBeenCalled();
    confirm();
    expect(screen.getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true");
    finish({ ok: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Payment account added."));
  });

  it("says why when the server refuses", async () => {
    vi.mocked(createPaymentAccount).mockResolvedValue({ ok: false, reason: "A GCash account with that number already exists." });
    render(<PaymentAccountForm />);
    openModal();
    fill();
    open();
    confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A GCash account with that number already exists."));
  });

  it("asks for a bank name only for bank transfer", () => {
    render(<PaymentAccountForm />);
    openModal();
    expect(screen.queryByLabelText("Bank name")).toBeNull();
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "bank_transfer" } });
    expect(screen.getByLabelText("Bank name")).toBeTruthy();
  });
});
