// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovalView } from "@/features/approvals/view";
import { todayInManila } from "@/features/returns/refund-record";
import { ReturnDetailView } from "@/features/returns/return-detail";
import type { ReturnDetail } from "@/features/returns/returns";

const { refresh, toast } = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/features/files/client", () => ({ uploadFile: vi.fn(async () => ({ ok: true, reference: "confirmed-image" })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/returns/actions", () => ({
  approveReturn: vi.fn(), declineReturn: vi.fn(), markReturnGoodsReceived: vi.fn(), markReturnRefunded: vi.fn(), markReturnReplaced: vi.fn(),
  extendRefundWindow: vi.fn(), changeRefundDestination: vi.fn(), revealRefundDestination: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
import { markReturnRefunded } from "@/features/returns/actions";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const detail = (overrides: Partial<ReturnDetail> = {}): ReturnDetail => ({
  replacedAt: null, videoFileId: null, refundProofFileId: null, refundWindowExtendedAt: null, replacementOrderId: null, refundDestination: null, refundDestinationLocked: false,
  orderDeliveryFee: 0, deliveryFeeRefunded: 0, deliveryFeeRefundable: false, preferredResolution: "refund", finalResolution: "refund", id: 15, number: "RMA-15", orderId: 1042,
  customer: { id: "c1", name: "Maria Santos" }, status: "goods received", requestedAt: new Date("2026-10-20T00:00:00Z"), amount: 21_900,
  items: [{ orderLineId: 1, product: "Smooth tub", size: "250g", quantity: 2, price: 10_950 }], reason: "damaged", note: "", goodsRequired: true, declineReason: null,
  refundedAt: null, orderStatus: "delivered", paymentMethod: "gcash", deliveredAt: new Date("2026-10-19T00:00:00Z"), deliveryPhotoFileId: null, deliveryPhotoRemovedAt: null,
  refundWindowEndsAt: null, images: [], history: [{ status: "requested", actor: { type: "customer", id: "c1", name: "Maria Santos" }, at: new Date("2026-10-20T01:00:00Z"), note: null }],
  ...overrides,
});
const approvedRefund = { id: "req-1", action: "return.refund", targetId: "15", status: "approved" } as ApprovalView;
const picture = () => new File([new Uint8Array([1, 2, 3])], "proof.png", { type: "image/png" });
const dialog = () => within(screen.getByRole("alertdialog"));
const open = () => fireEvent.click(screen.getByRole("button", { name: "Issue refund" }));
function fill(reference = "GC-2026-0001") {
  fireEvent.change(dialog().getByLabelText(/Sent by/), { target: { value: "gcash" } });
  fireEvent.change(dialog().getByLabelText(/Reference/), { target: { value: reference } });
  fireEvent.change(dialog().getByLabelText("Refund proof"), { target: { files: [picture()] } });
}
const confirm = () => fireEvent.click(dialog().getByRole("button", { name: /^Refund ₱/ }));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

describe("the Return's labels", () => {
  it("shows the five labels over the stored statuses", () => {
    for (const [status, goodsRequired, label] of [["requested", null, "Pending Review"], ["declined", null, "Rejected"], ["approved", true, "Awaiting Return"], ["goods received", true, "Returned"], ["refunded", true, "Refunded"]] as const) {
      const { unmount } = render(<ReturnDetailView detail={detail({ status, goodsRequired })} imageUrls={[]} />);
      expect(screen.getByRole("heading", { name: "RMA-15" }).parentElement!.textContent).toContain(label);
      unmount();
    }
  });
});

describe("the Issue refund dialog's details", () => {
  it("pre-fills the amount and today, and cannot be confirmed until how it was sent, the reference and the proof exist", () => {
    render(<ReturnDetailView detail={detail()} imageUrls={[]} />);
    open();
    expect((dialog().getByLabelText(/Amount sent/) as HTMLInputElement).value).toBe("219.00");
    expect((dialog().getByLabelText(/Date sent/) as HTMLInputElement).value).toBe(todayInManila());
    const button = () => dialog().getByRole("button", { name: /^Refund ₱/ }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    fireEvent.change(dialog().getByLabelText(/Sent by/), { target: { value: "gcash" } });
    fireEvent.change(dialog().getByLabelText("Refund proof"), { target: { files: [picture()] } });
    expect(button().disabled).toBe(true); // no reference yet
    fireEvent.change(dialog().getByLabelText(/Reference/), { target: { value: "GC-" } });
    expect(button().disabled).toBe(true); // too short
    fireEvent.change(dialog().getByLabelText(/Reference/), { target: { value: "GC-2026-0001" } });
    expect(button().disabled).toBe(false);
  });

  it("starts at the method the Customer confirmed and sends every detail with the proof", async () => {
    vi.mocked(markReturnRefunded).mockResolvedValue({ ok: true, return: { id: 15, status: "refunded" } });
    render(<ReturnDetailView detail={detail({ refundDestination: { method: "maya", accountName: "Maria", maskedNumber: "•••••••4567", bankName: null } })} imageUrls={[]} />);
    open();
    expect((dialog().getByLabelText(/Sent by/) as HTMLSelectElement).value).toBe("maya");
    fireEvent.change(dialog().getByLabelText(/Reference/), { target: { value: "MAYA-4455" } });
    fireEvent.change(dialog().getByLabelText("Refund proof"), { target: { files: [picture()] } });
    confirm();
    await waitFor(() => expect(markReturnRefunded).toHaveBeenCalledTimes(1));
    const form = vi.mocked(markReturnRefunded).mock.calls[0][1] as FormData;
    expect(Object.fromEntries(form.entries())).toEqual({ proof: "confirmed-image", sentAmount: "219.00", sentVia: "maya", sentOn: todayInManila(), sentReference: "MAYA-4455" });
  });
});

describe("instant refund (#613)", () => {
  const pill = () => screen.getByRole("heading", { name: "RMA-15", hidden: true }).parentElement!.textContent;

  it("shows Refunded at once when the approval is already decided, and rolls back with the reason if the server refuses", async () => {
    const answer = deferred<{ ok: false; reason: string }>();
    vi.mocked(markReturnRefunded).mockReturnValue(answer.promise);
    render(<ReturnDetailView detail={detail()} imageUrls={[]} requests={[approvedRefund]} />);
    open(); fill(); confirm();
    await waitFor(() => expect(pill()).toContain("Refunded"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await act(async () => answer.resolve({ ok: false, reason: "Return already changed; refresh it before trying again." }));
    await waitFor(() => expect(pill()).toContain("Returned"));
    expect(toast.error).toHaveBeenCalledWith("Return already changed; refresh it before trying again.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("waits for the server, with a spinner, when a Manager decides the refund themselves", async () => {
    const answer = deferred<{ ok: true; return: { id: number; status: "refunded" } }>();
    vi.mocked(markReturnRefunded).mockReturnValue(answer.promise);
    render(<ReturnDetailView detail={detail()} imageUrls={[]} />);
    open(); fill(); confirm();
    await waitFor(() => expect(markReturnRefunded).toHaveBeenCalled());
    expect(pill()).toContain("Returned");
    expect(dialog().getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => answer.resolve({ ok: true, return: { id: 15, status: "refunded" } }));
  });
});

describe("the recorded refund on the Return", () => {
  it("shows the amount, method, date and reference once Refunded", () => {
    render(<ReturnDetailView detail={detail({ status: "refunded", refundRecord: { amountInCentavos: 21_900, method: "bank-transfer", refundedOn: "2026-10-22", reference: "BPI-77821" } })} imageUrls={[]} />);
    const card = within(screen.getByRole("heading", { name: "Refund sent" }).closest("section")!);
    expect(card.getByText("₱219.00")).toBeTruthy();
    expect(card.getByText("Bank transfer")).toBeTruthy();
    expect(card.getByText("BPI-77821")).toBeTruthy();
    expect(card.getByText(/Oct/)).toBeTruthy();
  });

  it("shows no card for a refund made before these details existed", () => {
    render(<ReturnDetailView detail={detail({ status: "refunded" })} imageUrls={[]} />);
    expect(screen.queryByRole("heading", { name: "Refund sent" })).toBeNull();
  });
});
