// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setFreeDeliveryThreshold } from "@/features/management/delivery-actions";
import { FreeDeliveryForm } from "@/features/management/free-delivery-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/management/delivery-actions", () => ({ setFreeDeliveryThreshold: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const type = (v: string) => fireEvent.change(screen.getByLabelText("Amount (₱)"), { target: { value: v } });

describe("FreeDeliveryForm", () => {
  it("shows a plain-word error for an invalid amount and cannot be confirmed", () => {
    render(<FreeDeliveryForm currentInCentavos={250000} />);
    type(".");
    expect(screen.getByRole("alert").textContent).toMatch(/peso amount/);
    fireEvent.click(screen.getByRole("button", { name: "Save threshold" }));
    expect(screen.getAllByRole("button", { name: "Save threshold" }).at(-1)).toHaveProperty("disabled", true);
    expect(setFreeDeliveryThreshold).not.toHaveBeenCalled();
  });

  it("confirms first, shows a spinner while saving and is not optimistic", async () => {
    let finish!: (v: { ok: true }) => void;
    vi.mocked(setFreeDeliveryThreshold).mockReturnValue(new Promise((r) => { finish = r; }));
    render(<FreeDeliveryForm currentInCentavos={250000} />);
    type("3000");
    fireEvent.click(screen.getByRole("button", { name: "Save threshold" }));
    expect(setFreeDeliveryThreshold).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Save threshold" }).at(-1)!);
    expect(screen.getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Current: ₱2,500")).toBeTruthy();
    finish({ ok: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Free delivery threshold saved."));
    expect(setFreeDeliveryThreshold).toHaveBeenCalledWith("3000");
  });

  it("says why when the server refuses", async () => {
    vi.mocked(setFreeDeliveryThreshold).mockResolvedValue({ ok: false, reason: "Only a Manager can change the Free delivery threshold." });
    render(<FreeDeliveryForm currentInCentavos={250000} />);
    type("3000");
    fireEvent.click(screen.getByRole("button", { name: "Save threshold" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Save threshold" }).at(-1)!);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Only a Manager can change the Free delivery threshold."));
  });
});
