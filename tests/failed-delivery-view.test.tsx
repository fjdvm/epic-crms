// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toAttempts, type FailedAttempt } from "@/features/orders/failed-delivery";
import { changeFailedDelivery } from "@/features/orders/failed-delivery-actions";
import { FailedDeliveryView } from "@/features/orders/failed-delivery-view";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/orders/failed-delivery-actions", () => ({ changeFailedDelivery: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const order = { id: 7, status: "dispatched", customerName: "Ana Reyes", paymentMethod: "cod", total: 79_800, lines: [{ product: "Smooth tub", quantity: 2 }] };
const attempt = (o: Partial<FailedAttempt> = {}): FailedAttempt => ({
  id: "11111111-1111-4111-8111-111111111111", orderId: 7, reason: "Customer not home", nextStep: "rebook", customerMessage: "Hi",
  staffName: "Sam", createdAt: "2026-11-10T00:00:00.000Z", disposition: null, disposedAt: null, rebookedAt: null, courier: null, ...o,
});
const none = { waiting: false };

describe("the Failed delivery screen", () => {
  it("changes the reason at once and records it only after Staff confirm, waiting for the server", async () => {
    vi.mocked(changeFailedDelivery).mockResolvedValue({ ok: true, attemptId: "x" });
    render(<FailedDeliveryView order={order} attempts={[]} role="staff" writeOff={none} />);
    fireEvent.click(screen.getByRole("button", { name: "Refused the item" }));
    expect(screen.getByRole("button", { name: "Refused the item" }).getAttribute("aria-pressed")).toBe("true");
    expect(changeFailedDelivery).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save and send message" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save and send" }));
    expect(await screen.findByText("Saving…")).toBeTruthy();
    await waitFor(() => expect(changeFailedDelivery).toHaveBeenCalledWith(7, expect.objectContaining({ action: "record", reason: "Refused the item", nextStep: "rebook" })));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("says why when the server refuses", async () => {
    vi.mocked(changeFailedDelivery).mockResolvedValue({ ok: false, reason: "Failed attempt was not found or already changed." });
    render(<FailedDeliveryView order={order} attempts={[]} role="manager" writeOff={none} />);
    fireEvent.click(screen.getByRole("button", { name: "Save and send message" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save and send" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("already changed")));
  });

  it("shows Staff 'Request approval' for a write-off and asks with a reason", async () => {
    vi.mocked(changeFailedDelivery).mockResolvedValue({ ok: false, reason: "Waiting for approval" });
    render(<FailedDeliveryView order={order} attempts={[attempt()]} role="staff" writeOff={none} />);
    expect(screen.queryByRole("button", { name: "Write off…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Request approval…" }));
    const send = await screen.findByRole("button", { name: "Send request" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Out of the chiller too long" } });
    fireEvent.click(send);
    await waitFor(() => expect(changeFailedDelivery).toHaveBeenCalledWith(7, { action: "write-off", attemptId: attempt().id }, { reason: "Out of the chiller too long", approvalId: undefined }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("lets a Manager write off directly and view-only roles do nothing", () => {
    const { unmount } = render(<FailedDeliveryView order={order} attempts={[attempt()]} role="manager" writeOff={none} />);
    expect(screen.getByRole("button", { name: "Write off…" })).toBeTruthy();
    unmount();
    render(<FailedDeliveryView order={order} attempts={[attempt()]} role="ceo" writeOff={none} />);
    expect(screen.queryByRole("button", { name: "Write off…" })).toBeNull();
    expect(screen.getByText("View only.")).toBeTruthy();
  });

  it("shows Waiting for approval, then the approved write-off to Staff", () => {
    const { unmount } = render(<FailedDeliveryView order={order} attempts={[attempt()]} role="staff" writeOff={{ waiting: true }} />);
    expect(screen.getByText("Waiting for approval")).toBeTruthy();
    unmount();
    render(<FailedDeliveryView order={order} attempts={[attempt()]} role="staff" writeOff={{ waiting: false, approvalId: "22222222-2222-4222-8222-222222222222" }} />);
    expect(screen.getByRole("button", { name: "Write off…" })).toBeTruthy();
  });

  it("shows the Customer's earlier failures and maps storefront rows", () => {
    const rows = [{ id: "a", order_id: 3, reason: "Refused to pay COD", next_step: "rebook", customer_message: "m", staff_name: "S", created_at: new Date("2026-08-01"), disposition: null, disposed_at: null, rebooked_at: null, courier: null }];
    render(<FailedDeliveryView order={order} attempts={toAttempts(rows)} role="staff" writeOff={none} />);
    expect(screen.getByText("1 (Refused to pay COD)")).toBeTruthy();
  });
});

describe("the Failed delivery loading state", () => {
  it("shows the heading and skeleton at once", async () => {
    const { default: Loading } = await import("@/app/(app)/orders/[id]/failed-delivery/loading");
    render(<Loading />);
    expect(screen.getByRole("status", { name: "Loading failed delivery" })).toBeTruthy();
    expect(screen.getByText("Failed delivery")).toBeTruthy();
  });
});
