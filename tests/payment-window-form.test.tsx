// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentWindowForm } from "@/features/management/payment-window-form";
import { changePaymentWindowHours } from "@/features/management/settings-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/management/settings-actions", () => ({ changePaymentWindowHours: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const type = (v: string) => fireEvent.change(screen.getByLabelText("Window (hours)"), { target: { value: v } });
const open = () => fireEvent.click(screen.getByRole("button", { name: "Save payment window" }));
const confirm = () => fireEvent.click(screen.getAllByRole("button", { name: "Save payment window" }).at(-1)!);

describe("PaymentWindowForm", () => {
  it("shows a plain-word error for invalid hours and cannot be confirmed", () => {
    render(<PaymentWindowForm currentHours={24} />);
    type("0");
    expect(screen.getByRole("alert").textContent).toMatch(/1 to 336/);
    open();
    expect(screen.getAllByRole("button", { name: "Save payment window" }).at(-1)).toHaveProperty("disabled", true);
    expect(changePaymentWindowHours).not.toHaveBeenCalled();
  });

  it("confirms first, spins while saving and is not optimistic", async () => {
    let finish!: (v: { ok: true }) => void;
    vi.mocked(changePaymentWindowHours).mockReturnValue(new Promise((r) => { finish = r; }));
    render(<PaymentWindowForm currentHours={24} />);
    type("48");
    open();
    expect(changePaymentWindowHours).not.toHaveBeenCalled();
    confirm();
    expect(screen.getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Current: 24 hours")).toBeTruthy();
    finish({ ok: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Payment window saved."));
    expect(changePaymentWindowHours).toHaveBeenCalledWith("48");
  });

  it("says why when the server refuses and keeps the shown value", async () => {
    vi.mocked(changePaymentWindowHours).mockResolvedValue({ ok: false, reason: "Only a Manager can change the payment window." });
    render(<PaymentWindowForm currentHours={24} />);
    type("48");
    open();
    confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Only a Manager can change the payment window."));
    expect(screen.getByText("Current: 24 hours")).toBeTruthy();
  });
});
