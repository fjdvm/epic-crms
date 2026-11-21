// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { approveCancelRequest, declineCancelRequest } from "@/features/orders/actions";
import { CancelRequestAction, CancelRequestNote } from "@/features/orders/cancel-request";
import type { CancelRequestState } from "@/features/orders/cancel-request-state";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/orders/actions", () => ({ approveCancelRequest: vi.fn(), declineCancelRequest: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const request: CancelRequestState = { requestId: "11111111-1111-4111-8111-111111111111", status: "waiting", reason: "Wrong address", requestedBy: "Maria Santos",
  requestedAt: new Date("2026-11-22T00:00:00Z"), declineReason: null, decidedBy: null };

describe("the cancel request on an Order", () => {
  it("Staff and Managers with Orders can open the decision; nobody else can", () => {
    for (const role of ["staff", "manager"] as const) {
      render(<CancelRequestAction id={7} state={request} role={role} canDecide />);
      expect(screen.getByRole("button", { name: /Review cancel request/ })).toBeTruthy();
      cleanup();
    }
    for (const [role, canDecide] of [["admin", true], ["ceo", true], ["staff", false]] as const) {
      render(<CancelRequestAction id={7} state={request} role={role} canDecide={canDecide} />);
      expect(screen.queryByRole("button", { name: /Review cancel request/ })).toBeNull();
      expect(screen.getByText("Customer asked to cancel")).toBeTruthy();
      cleanup();
    }
  });

  it("shows nothing once the request is decided", () => {
    const { container } = render(<CancelRequestAction id={7} state={{ ...request, status: "approved" }} role="staff" canDecide />);
    expect(container.textContent).toBe("");
  });

  it("approving waits for the server, then says the Customer is emailed", async () => {
    vi.mocked(approveCancelRequest).mockResolvedValue({ ok: true, order: { id: 7, status: "cancelled", deliveryFeeInCentavos: null } });
    render(<CancelRequestAction id={7} state={request} role="staff" canDecide />);
    fireEvent.click(screen.getByRole("button", { name: /Review cancel request/ }));
    fireEvent.click(screen.getByRole("button", { name: "Approve and cancel" }));
    await waitFor(() => expect(approveCancelRequest).toHaveBeenCalledWith(7, request.requestId));
    expect(toast.success).toHaveBeenCalledWith("Order #7 is cancelled and the Customer is emailed.");
  });

  it("declining needs a reason the Customer will see", async () => {
    vi.mocked(declineCancelRequest).mockResolvedValue({ ok: true, order: { id: 7, status: "unchanged", deliveryFeeInCentavos: null } });
    render(<CancelRequestAction id={7} state={request} role="manager" canDecide />);
    fireEvent.click(screen.getByRole("button", { name: /Review cancel request/ }));
    fireEvent.click(screen.getByLabelText(/Decline: the Order carries on/));
    expect(screen.getByRole("button", { name: "Decline request" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/Reason the Customer will see/), { target: { value: "Already packed" } });
    fireEvent.click(screen.getByRole("button", { name: "Decline request" }));
    await waitFor(() => expect(declineCancelRequest).toHaveBeenCalledWith(7, request.requestId, "Already packed"));
  });

  it("says why when the server refuses", async () => {
    vi.mocked(approveCancelRequest).mockResolvedValue({ ok: false, reason: "This request was already decided or withdrawn. Refresh the Order." });
    render(<CancelRequestAction id={7} state={request} role="staff" canDecide />);
    fireEvent.click(screen.getByRole("button", { name: /Review cancel request/ }));
    fireEvent.click(screen.getByRole("button", { name: "Approve and cancel" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This request was already decided or withdrawn. Refresh the Order."));
  });

  it("the note explains the pause and the last decline", () => {
    render(<CancelRequestNote state={request} />);
    expect(screen.getByRole("note").textContent).toContain("Other actions are paused");
    cleanup();
    render(<CancelRequestNote state={{ ...request, status: "declined", declineReason: "Already packed", decidedBy: "Ana" }} />);
    expect(screen.getByRole("note").textContent).toContain("declined by Ana: Already packed");
  });
});
