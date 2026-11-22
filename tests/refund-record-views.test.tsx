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
vi.mock("@/features/returns/refund-proof-actions", () => ({ saveRefundProof: vi.fn(), correctRefundReading: vi.fn(), proceedDespiteRefundFlag: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
import { markReturnRefunded } from "@/features/returns/actions";
import { correctRefundReading, proceedDespiteRefundFlag, saveRefundProof } from "@/features/returns/refund-proof-actions";

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
const open = () => fireEvent.click(screen.getByRole("button", { name: "Save refund proof" }));
function fill(reference = "GC-2026-0001") {
  fireEvent.change(dialog().getByLabelText(/Sent by/), { target: { value: "gcash" } });
  fireEvent.change(dialog().getByLabelText(/Reference/), { target: { value: reference } });
  fireEvent.change(dialog().getByLabelText("Refund proof"), { target: { files: [picture()] } });
}
const confirm = () => fireEvent.click(dialog().getByRole("button", { name: "Save proof" }));
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
    const button = () => dialog().getByRole("button", { name: "Save proof" }) as HTMLButtonElement;
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
    vi.mocked(saveRefundProof).mockResolvedValue({ ok: true });
    render(<ReturnDetailView detail={detail({ refundDestination: { method: "maya", accountName: "Maria", maskedNumber: "•••••••4567", bankName: null } })} imageUrls={[]} />);
    open();
    expect((dialog().getByLabelText(/Sent by/) as HTMLSelectElement).value).toBe("maya");
    fireEvent.change(dialog().getByLabelText(/Reference/), { target: { value: "MAYA-4455" } });
    fireEvent.change(dialog().getByLabelText("Refund proof"), { target: { files: [picture()] } });
    confirm();
    await waitFor(() => expect(saveRefundProof).toHaveBeenCalledTimes(1));
    expect(markReturnRefunded).not.toHaveBeenCalled();
    const form = vi.mocked(saveRefundProof).mock.calls[0][1] as FormData;
    expect(Object.fromEntries(form.entries())).toEqual({ proof: "confirmed-image", sentAmount: "219.00", sentVia: "maya", sentOn: todayInManila(), sentReference: "MAYA-4455" });
  });
});

const saved = { amountInCentavos: 21_900, method: "gcash", refundedOn: "2026-10-22", reference: "GC-2026-0001", reading: false, unresolved: [] as string[] };
const markOpen = () => fireEvent.click(screen.getByRole("button", { name: "Mark refunded" }));
const verify = () => fireEvent.click(dialog().getByLabelText(/I verified the real transfer/));
const markConfirm = () => fireEvent.click(dialog().getByRole("button", { name: /^Mark ₱/ }));

describe("Mark refunded after the proof is saved (#615)", () => {
  const pill = () => screen.getByRole("heading", { name: "RMA-15", hidden: true }).parentElement!.textContent;

  it("offers Mark refunded only once a proof and its details are saved", () => {
    const { unmount } = render(<ReturnDetailView detail={detail()} imageUrls={[]} />);
    expect(screen.queryByRole("button", { name: "Mark refunded" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save refund proof" })).toBeTruthy();
    unmount();
    render(<ReturnDetailView detail={detail()} imageUrls={[]} savedProof={saved} />);
    expect(screen.getByRole("button", { name: "Mark refunded" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace refund proof" })).toBeTruthy();
  });

  it("shows the saved details and a reminder to verify the real transfer, and needs that confirmed", () => {
    render(<ReturnDetailView detail={detail()} imageUrls={[]} savedProof={saved} />);
    markOpen();
    expect(dialog().getByText("GC-2026-0001")).toBeTruthy();
    expect(dialog().getByText(/Verify the real transfer with the payment provider/)).toBeTruthy();
    const button = dialog().getByRole("button", { name: /^Mark ₱/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    verify();
    expect(button.disabled).toBe(false);
  });

  it("holds Mark refunded while the reader is still reading or details are flagged, and says which", () => {
    const { unmount } = render(<ReturnDetailView detail={detail()} imageUrls={[]} savedProof={{ ...saved, reading: true }} />);
    markOpen(); verify();
    expect(dialog().getByRole("alert").textContent).toContain("still checking");
    expect((dialog().getByRole("button", { name: /^Mark ₱/ }) as HTMLButtonElement).disabled).toBe(true);
    unmount(); cleanup();
    render(<ReturnDetailView detail={detail()} imageUrls={[]} savedProof={{ ...saved, unresolved: ["amount", "reference"] }} />);
    markOpen(); verify();
    expect(dialog().getByRole("alert").textContent).toContain("amount, reference");
    expect((dialog().getByRole("button", { name: /^Mark ₱/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends only the confirmation that the transfer was verified, never details or the proof again", async () => {
    vi.mocked(markReturnRefunded).mockResolvedValue({ ok: true, return: { id: 15, status: "refunded" } });
    render(<ReturnDetailView detail={detail()} imageUrls={[]} savedProof={saved} />);
    markOpen(); verify(); markConfirm();
    await waitFor(() => expect(markReturnRefunded).toHaveBeenCalledTimes(1));
    const form = vi.mocked(markReturnRefunded).mock.calls[0][1] as FormData;
    expect(Object.fromEntries(form.entries())).toEqual({ transferVerified: "true" });
  });

  it("shows Refunded at once when the approval is already decided, and rolls back with the reason if the server refuses", async () => {
    const answer = deferred<{ ok: false; reason: string }>();
    vi.mocked(markReturnRefunded).mockReturnValue(answer.promise);
    render(<ReturnDetailView detail={detail()} imageUrls={[]} savedProof={saved} requests={[approvedRefund]} />);
    markOpen(); verify(); markConfirm();
    await waitFor(() => expect(pill()).toContain("Refunded"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await act(async () => answer.resolve({ ok: false, reason: "Correct or proceed past the flagged details first: amount." }));
    await waitFor(() => expect(pill()).toContain("Returned"));
    expect(toast.error).toHaveBeenCalledWith("Correct or proceed past the flagged details first: amount.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("waits for the server, with a spinner, when a Manager decides the refund themselves", async () => {
    const answer = deferred<{ ok: true; return: { id: number; status: "refunded" } }>();
    vi.mocked(markReturnRefunded).mockReturnValue(answer.promise);
    render(<ReturnDetailView detail={detail()} imageUrls={[]} savedProof={saved} />);
    markOpen(); verify(); markConfirm();
    await waitFor(() => expect(markReturnRefunded).toHaveBeenCalled());
    expect(pill()).toContain("Returned");
    expect(dialog().getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => answer.resolve({ ok: true, return: { id: 15, status: "refunded" } }));
  });

  it("saving the proof waits for the server with a spinner and tells a refusal in plain words", async () => {
    const answer = deferred<{ ok: false; reason: string }>();
    vi.mocked(saveRefundProof).mockReturnValue(answer.promise);
    render(<ReturnDetailView detail={detail()} imageUrls={[]} />);
    open(); fill(); confirm();
    await waitFor(() => expect(saveRefundProof).toHaveBeenCalled());
    expect(dialog().getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => answer.resolve({ ok: false, reason: "The amount sent must match the refund: ₱219.00." }));
    expect(toast.error).toHaveBeenCalledWith("The amount sent must match the refund: ₱219.00.");
  });
});

describe("the saved proof's findings before Mark refunded (#615)", () => {
  const read = { status: "read" as const, flags: { reusedReferenceOrderIds: [], reusedImageProofIds: [] }, corrections: [], findings: {
    amount: { finding: "Mismatch" as const, read: "190.00", expected: "₱219.00" }, date: { finding: "Match" as const, read: "2026-10-22", expected: "after 2026-10-20" },
    reference: { finding: "Match" as const, read: "GC-2026-0001", expected: "GC-2026-0001" }, recipient: { finding: "Match" as const, read: "MARIA", expected: "Maria" },
    accountNumber: { finding: "Needs Review" as const, read: "0917 *** 4567", expected: "09171234567" } } };
  const card = () => within(screen.getByRole("heading", { name: "Refund proof" }).closest("section")!);

  it("shows the saved details, the findings and the reminder on the Refund proof card before the Return is Refunded", () => {
    render(<ReturnDetailView detail={detail()} imageUrls={[]} role="staff" refundProofUrl="https://files.test/p.png" refundRead={read} savedProof={{ ...saved, unresolved: ["amount", "accountNumber"] }} />);
    expect(card().getByText("GC-2026-0001", { selector: "dd" })).toBeTruthy();
    expect(card().getByText(/Saved, not marked Refunded yet/)).toBeTruthy();
    expect(card().getByText("Mismatch")).toBeTruthy();
    expect(card().getByText(/Verify the real transfer before marking refunded/)).toBeTruthy();
  });

  it("lets Staff correct or proceed with a reason, recorded against the Return", async () => {
    vi.mocked(proceedDespiteRefundFlag).mockResolvedValue({ ok: true });
    vi.mocked(correctRefundReading).mockResolvedValue({ ok: true });
    render(<ReturnDetailView detail={detail()} imageUrls={[]} role="staff" refundProofUrl="https://files.test/p.png" refundRead={read} savedProof={{ ...saved, unresolved: ["amount"] }} />);
    const amount = card().getByText("Amount").closest("li")!;
    fireEvent.click(within(amount).getByRole("button", { name: "Proceed anyway" }));
    fireEvent.change(dialog().getByLabelText("Reason"), { target: { value: "Receipt is cropped" } });
    fireEvent.click(dialog().getByRole("button", { name: "Record and proceed" }));
    await waitFor(() => expect(proceedDespiteRefundFlag).toHaveBeenCalledWith(15, "amount", "Receipt is cropped"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(within(amount).getByRole("button", { name: "Correct" }));
    fireEvent.change(dialog().getByLabelText(/Corrected amount/), { target: { value: "219.00" } });
    fireEvent.change(dialog().getByLabelText("Reason"), { target: { value: "Typo in the read" } });
    fireEvent.click(dialog().getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(correctRefundReading).toHaveBeenCalledWith(15, "amount", "219.00", "Typo in the read"));
  });

  it("shows Admin and the CEO the findings with no controls and no way to cause a read", () => {
    for (const role of ["admin"] as const) {
      const { unmount } = render(<ReturnDetailView detail={detail()} imageUrls={[]} role={role} refundProofUrl="https://files.test/p.png" refundRead={read} savedProof={saved} />);
      expect(card().getByText("Mismatch")).toBeTruthy();
      expect(card().queryAllByRole("button").filter((b) => !b.getAttribute("aria-label")?.startsWith("Zoom "))).toEqual([]);
      expect(screen.queryByRole("button", { name: "Mark refunded" })).toBeNull();
      unmount();
    }
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
