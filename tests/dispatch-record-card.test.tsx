// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchOrder, updateDispatchRecord } from "@/features/orders/actions";
import { DispatchRecordCard } from "@/features/orders/dispatch-record-card";
import { checkBooking, linkProblem, type DispatchRecord } from "@/features/orders/dispatch-record";
import { FulfilmentBoardView } from "@/features/orders/fulfilment-board";
import { OrderDetailView } from "@/features/orders/order-detail";
import type { OrderDetail } from "@/features/orders/orders";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/files/client", () => ({ uploadFile: vi.fn() }));
vi.mock("@/features/orders/actions", () => ({
  updateDispatchRecord: vi.fn(), dispatchOrder: vi.fn(), startPreparing: vi.fn(), loadPackingSlip: vi.fn(), deliverOrder: vi.fn(),
  markReadyForPickup: vi.fn(), markPickedUp: vi.fn(), quoteDeliveryFee: vi.fn(), confirmPickup: vi.fn(), cancelOrder: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const record = (overrides: Partial<DispatchRecord> = {}): DispatchRecord => ({
  courier: "Lalamove", trackingUrl: null, rider: { name: "Juan", phone: "0917 123 4567", plate: "ABC 123" }, ...overrides,
});
const deferred = <T,>() => { let settle!: (value: T) => void; const promise = new Promise<T>(r => (settle = r)); return { promise, settle }; };

describe("the booking rules, shared by the form and the server", () => {
  it("needs a courier, accepts no link or an https link, and limits length", () => {
    expect(checkBooking({ courier: "Grab" })).toMatchObject({ ok: true, booking: { name: "Grab" } });
    expect(checkBooking({ courier: "Grab", trackingUrl: "  " })).toMatchObject({ ok: true });
    expect(checkBooking({ courier: "Other" })).toMatchObject({ ok: false });
    expect(checkBooking(undefined)).toMatchObject({ ok: false });
    expect(linkProblem("https://share.lalamove.com/a?b=1")).toBeNull();
    for (const bad of ["http://a.com", "ftp://a.com", "share.lalamove.com", "https://", "https://a.com/ b", "javascript:alert(1)", `https://a.com/${"x".repeat(2100)}`]) {
      expect(linkProblem(bad), bad).not.toBeNull();
    }
  });
});

describe("the Dispatch card", () => {
  it("shows the courier, 'No link yet' and the rider details when it was given them", () => {
    render(<DispatchRecordCard orderId={7} record={record()} editable />);
    const card = screen.getByTestId("dispatch-record");
    expect(within(card).getByText("Lalamove")).toBeTruthy();
    expect(within(card).getByText("No link yet")).toBeTruthy();
    expect(within(card).getByText("Juan")).toBeTruthy();
    expect(within(card).getByText("0917 123 4567")).toBeTruthy();
  });

  it("shows no rider rows when the viewer was not given rider details", () => {
    render(<DispatchRecordCard orderId={7} record={record({ rider: null, trackingUrl: "https://share.lalamove.com/a" })} editable={false} />);
    expect(screen.queryByText("Rider")).toBeNull();
    expect(screen.queryByText("Juan")).toBeNull();
    expect(screen.getByRole("link", { name: "https://share.lalamove.com/a" }).getAttribute("rel")).toContain("noopener");
    expect(screen.queryByRole("button", { name: "Edit dispatch details" })).toBeNull();
  });

  it("asks first, shows the new link at once, and rolls back with the reason when the server refuses", async () => {
    const pending = deferred<Awaited<ReturnType<typeof updateDispatchRecord>>>();
    vi.mocked(updateDispatchRecord).mockReturnValue(pending.promise);
    render(<DispatchRecordCard orderId={7} record={record()} editable />);
    fireEvent.click(screen.getByRole("button", { name: "Edit dispatch details" }));
    const dialog = screen.getByRole("alertdialog", { name: "Change the dispatch details of Order #7?" });
    expect((within(dialog).getByLabelText("Rider name (optional)") as HTMLInputElement).value).toBe("Juan");
    fireEvent.change(within(dialog).getByLabelText("Booking share link (optional)"), { target: { value: "http://bad" } });
    expect(within(dialog).getByRole("alert").textContent).toContain("https://");
    expect((within(dialog).getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Booking share link (optional)"), { target: { value: "https://share.lalamove.com/z" } });
    expect(updateDispatchRecord).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(updateDispatchRecord).toHaveBeenCalledWith(7, expect.objectContaining({ courier: "Lalamove", trackingUrl: "https://share.lalamove.com/z", riderName: "Juan" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("link", { name: "https://share.lalamove.com/z" })).toBeTruthy();
    await act(async () => pending.settle({ ok: false, reason: "Order already changed." }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Order already changed."));
    expect(screen.getByText("No link yet")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "https://share.lalamove.com/z" })).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });
});

const detail = (overrides: Partial<OrderDetail>): OrderDetail => ({
  id: 7, status: "dispatched", createdAt: new Date("2026-10-20T00:00:00Z"), fulfillmentMethod: "delivery", paymentMethod: "gcash",
  lines: [{ product: "Halaya", size: "500g", quantity: 2, price: 50_000 }], subtotal: 100_000, discount: 0, deliveryFee: 15_000, total: 115_000,
  paymentProofs: [], proofRejections: 0, deliveryPhotoFileId: null, deliveryPhotoRemovedAt: null, paidBy: null, codCollection: null, packedBy: null,
  address: null, feedback: null, paymentProof: null, paymentLabel: "Paid", customer: { id: "c1", name: "Maria Santos" },
  ...overrides,
} as OrderDetail);

describe("the Order page", () => {
  const view = (props: Partial<Parameters<typeof OrderDetailView>[0]>) =>
    render(<OrderDetailView role="staff" order={detail({})} modules={["Orders", "Fulfilment"]} returns={[]} reservations={new Map()} dispatch={record()} {...props} />);

  it("lets Staff edit while dispatched, but not once delivered, and never on a Pickup Order", () => {
    const { unmount } = view({});
    expect(screen.getByRole("button", { name: "Edit dispatch details" })).toBeTruthy();
    unmount();
    const delivered = view({ order: detail({ status: "delivered" }) });
    expect(screen.getByTestId("dispatch-record")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit dispatch details" })).toBeNull();
    delivered.unmount();
    view({ order: detail({ fulfillmentMethod: "pickup", status: "ready for pickup" }) });
    expect(screen.queryByTestId("dispatch-record")).toBeNull();
  });

  it.each(["admin", "ceo"] as const)("is read-only for %s", role => {
    view({ role, dispatch: record({ rider: null }) });
    expect(screen.getByTestId("dispatch-record")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit dispatch details" })).toBeNull();
    expect(screen.queryByText("Juan")).toBeNull();
  });
});

describe("dispatching from the board", () => {
  it("needs only the courier; the link and rider stay optional, and the move shows at once", async () => {
    const pending = deferred<Awaited<ReturnType<typeof dispatchOrder>>>();
    vi.mocked(dispatchOrder).mockReturnValue(pending.promise);
    render(<FulfilmentBoardView board={{ orders: [{
      id: 3, createdAt: new Date(), customerId: "c1", customerName: "Maria", lines: [], total: 1000, status: "preparing", paymentLabel: "Paid",
      fulfillmentMethod: "delivery", paymentMethod: "gcash", deliveredAt: null, packedBy: null, failedOpen: false,
    }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as dispatched" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Mark as dispatched" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("radio", { name: "Grab" }));
    expect(confirm.disabled).toBe(false);
    fireEvent.change(within(dialog).getByLabelText("Booking share link (optional)"), { target: { value: "ftp://x" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Booking share link (optional)"), { target: { value: "" } });
    fireEvent.click(confirm);
    expect(dispatchOrder).toHaveBeenCalledWith(3, expect.objectContaining({ courier: "Grab", trackingUrl: "" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await act(async () => pending.settle({ ok: false, reason: "Another Staff member has already moved this Order." }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Another Staff member has already moved this Order."));
  });
});
