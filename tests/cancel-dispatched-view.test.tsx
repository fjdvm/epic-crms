// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { decideApproval } from "@/features/approvals/actions";
import { CancelDispatched, CancellationNote } from "@/features/orders/cancel-dispatched";
import { requestDispatchedCancellation, settleDispatchedCancellation } from "@/features/orders/cancellation-actions";
import type { CancellationState } from "@/features/orders/cancellation-state";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/orders/cancellation-actions", () => ({ requestDispatchedCancellation: vi.fn(), settleDispatchedCancellation: vi.fn() }));
vi.mock("@/features/approvals/actions", () => ({ decideApproval: vi.fn() }));
vi.mock("@/features/files/client", () => ({ uploadFile: vi.fn(async () => ({ ok: true, reference: "ref-1" })) }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const state = (status: CancellationState["status"], extra: Partial<CancellationState> = {}): CancellationState => ({
  requestId: "r1", status, reason: "Wrong address", declineReason: null, stockOutcome: null, refundMethod: null, requestedBy: "Ana", ...extra,
});
const view = (role: "staff" | "manager" | "admin" | "ceo", s: CancellationState | null, paymentMethod = "gcash") =>
  render(<CancelDispatched id={7} total={115_000} paymentMethod={paymentMethod} role={role} state={s} />);
const never = () => new Promise<never>(() => {});

it("Staff see Request approval, and the request shows a spinner at once and waits for the server", async () => {
  vi.mocked(requestDispatchedCancellation).mockImplementation(never);
  view("staff", null);
  fireEvent.click(screen.getByRole("button", { name: "Request approval…" }));
  const send = screen.getByRole("button", { name: "Send request" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Wrong address" } });
  fireEvent.click(send);
  expect((await screen.findByRole("button", { name: "Sending…" })).getAttribute("aria-busy")).toBe("true");
  expect(requestDispatchedCancellation).toHaveBeenCalledWith(7, "Wrong address");
});

it("a refused request says why", async () => {
  vi.mocked(requestDispatchedCancellation).mockResolvedValue({ ok: false, reason: "Only a dispatched Order can be cancelled." });
  view("staff", null);
  fireEvent.click(screen.getByRole("button", { name: "Request approval…" }));
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Send request" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Only a dispatched Order can be cancelled."));
});

it("shows Waiting for approval to Staff, the decision dialog to a Manager, and nothing to Admin or the CEO", () => {
  view("staff", state("waiting-manager"));
  expect(screen.getByText("Waiting for approval")).toBeTruthy();
  cleanup();
  view("manager", state("waiting-manager"));
  expect(screen.getByRole("button", { name: "Review cancellation…" })).toBeTruthy();
  cleanup();
  view("admin", null);
  expect(screen.queryByRole("button")).toBeNull();
  cleanup();
  view("ceo", null);
  expect(screen.queryByRole("button")).toBeNull();
});

it("the Manager's decline needs a reason and waits for the server", async () => {
  vi.mocked(decideApproval).mockImplementation(never);
  view("manager", state("waiting-manager"));
  fireEvent.click(screen.getByRole("button", { name: "Review cancellation…" }));
  expect(screen.getByText(/Refund ₱1,150.00/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText(/Decline/));
  const decline = screen.getByRole("button", { name: "Decline" }) as HTMLButtonElement;
  expect(decline.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Parcel is at the door" } });
  fireEvent.click(decline);
  expect(await screen.findByRole("button", { name: "Declining…" })).toBeTruthy();
  expect(decideApproval).toHaveBeenCalledWith("Fulfilment", "r1", "decline", "Parcel is at the door");
});

it("settling a prepaid Order needs refund proof; Cash on Delivery needs none", async () => {
  vi.mocked(settleDispatchedCancellation).mockResolvedValue({ ok: false, reason: "IMS did not confirm" });
  view("manager", state("approved"));
  fireEvent.click(screen.getByRole("button", { name: "Refund and settle stock…" }));
  expect((screen.getByRole("button", { name: "Cancel order" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Refund proof"), { target: { files: [new File(["x"], "p.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByLabelText(/Write off/));
  fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
  await waitFor(() => expect(settleDispatchedCancellation).toHaveBeenCalled());
  expect(vi.mocked(settleDispatchedCancellation).mock.calls[0].slice(0, 3)).toEqual([7, "r1", "write-off"]);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("IMS did not confirm"));
  cleanup();
  view("manager", state("approved"), "cash-on-delivery");
  fireEvent.click(screen.getByRole("button", { name: "Refund and settle stock…" }));
  expect((screen.getByRole("button", { name: "Cancel order" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText(/no refund/i)).toBeTruthy();
});

it("a declined request shows its reason and offers no new request", () => {
  const declined = state("declined", { declineReason: "Parcel is at the door" });
  view("staff", declined);
  expect(screen.queryByRole("button")).toBeNull();
  cleanup();
  render(<CancellationNote state={declined} />);
  expect(screen.getByRole("note").textContent).toContain("Parcel is at the door");
});
