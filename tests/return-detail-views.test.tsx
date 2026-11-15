// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ReturnActions } from "@/features/returns/return-actions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReturnDetailView } from "@/features/returns/return-detail";
import type { ReturnDetail } from "@/features/returns/returns";

const { refresh, toast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/features/files/client", () => ({ uploadFile: vi.fn(async () => ({ ok: true, reference: "confirmed-image" })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/returns/actions", () => ({
  approveReturn: vi.fn(),
  declineReturn: vi.fn(),
  markReturnGoodsReceived: vi.fn(),
  markReturnRefunded: vi.fn(),
  markReturnReplaced: vi.fn(),
  extendRefundWindow: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

import { approveReturn, declineReturn, extendRefundWindow, markReturnGoodsReceived, markReturnRefunded, markReturnReplaced } from "@/features/returns/actions";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const detail = (overrides: Partial<ReturnDetail> = {}): ReturnDetail => ({
  replacedAt: null, videoFileId: null, refundProofFileId: null, refundWindowExtendedAt: null, replacementOrderId: null,
  preferredResolution: "refund", finalResolution: null,
  id: 15,
  number: "RMA-15",
  orderId: 1042,
  customer: { id: "c1", name: "Maria Santos" },
  status: "requested",
  requestedAt: new Date("2026-10-20T00:00:00Z"),
  amount: 21_900,
  items: [{ orderLineId: 1, product: "Smooth tub", size: "250g", quantity: 2, price: 10_950 }],
  reason: "damaged",
  note: "Lid was cracked on arrival",
  goodsRequired: null,
  declineReason: null,
  refundedAt: null,
  orderStatus: "delivered",
  paymentMethod: "gcash",
  deliveredAt: new Date("2026-10-19T00:00:00Z"),
  deliveryPhotoFileId: "photo-1",
  deliveryPhotoRemovedAt: null,
  refundWindowEndsAt: null,
  images: [{ fileId: "img-1", position: 0 }],
  history: [
    { status: "requested", actor: { type: "customer", id: "c1", name: "Maria Santos" }, at: new Date("2026-10-20T01:00:00Z"), note: null },
  ],
  ...overrides,
});

const view = (
  d: ReturnDetail,
  urls: (string | null)[] = ["https://files/img-1"],
  photo: string | null | undefined = "https://files/photo-1",
  extra: { videoUrl?: string | null; refundProofUrl?: string | null } = {},
) => render(<ReturnDetailView detail={d} imageUrls={urls} deliveryPhotoUrl={photo} {...extra} />);

const picture = (name = "proof.png", type = "image/png") => new File([new Uint8Array([1, 2, 3])], name, { type });

const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent);

describe("the Return detail", () => {
  it("says the Delivery photo was removed, and No photo when the Order never had one", () => {
    const { unmount } = render(
      <ReturnDetailView detail={detail({ deliveryPhotoFileId: null, deliveryPhotoRemovedAt: new Date("2026-10-30T00:00:00Z") })} imageUrls={[]} />,
    );
    expect(screen.getByText("The Delivery photo was removed.")).toBeTruthy();
    expect(screen.queryByText("No photo")).toBeNull();
    unmount();

    render(<ReturnDetailView detail={detail({ deliveryPhotoFileId: null })} imageUrls={[]} />);
    expect(screen.getByText("No photo")).toBeTruthy();
    expect(screen.queryByText("The Delivery photo was removed.")).toBeNull();
  });

  it("shows the reason, note, items, amount, images, payment method and Delivery photo", () => {
    view(detail());

    expect(screen.getByRole("heading", { name: "RMA-15" })).toBeTruthy();
    expect(screen.getByText("Damaged")).toBeTruthy();
    expect(screen.getByText("Lid was cracked on arrival")).toBeTruthy();
    expect(screen.getByText("Smooth tub")).toBeTruthy();
    expect(screen.getByText("₱219.00")).toBeTruthy();
    expect(screen.getByText("GCash")).toBeTruthy();
    expect(screen.getByAltText("Defect image 1 for RMA-15").getAttribute("src")).toBe("https://files/img-1");
    expect(screen.getByAltText("Delivery photo for Order #1042").getAttribute("src")).toBe("https://files/photo-1");
  });

  it("says an image could not be loaded instead of leaving a gap", () => {
    view(detail(), [null], null);

    expect(screen.getAllByText(/could not be loaded/)).toHaveLength(2);
  });

  it("shows who did each step and when", () => {
    view(
      detail({
        status: "approved",
        goodsRequired: true,
        history: [
          { status: "requested", actor: { type: "customer", id: "c1", name: "Maria Santos" }, at: new Date("2026-10-20T01:00:00Z"), note: null },
          { status: "approved", actor: { type: "staff", id: "ana", name: "Ana Reyes" }, at: new Date("2026-10-21T02:30:00Z"), note: null },
        ],
      }),
    );

    expect(screen.getByText(/Ana Reyes · 21 Oct 2026, 10:30\sam/i)).toBeTruthy();
    expect(screen.getByText(/Maria Santos \(Customer\) · 20 Oct 2026, 9:00\sam/i)).toBeTruthy();
  });

  it.each([
    ["requested", null, ["Decline", "Approve"]],
    ["approved", true, ["Mark goods received"]],
    ["approved", false, ["Issue refund"]],
    ["goods received", true, ["Issue refund", "Save inspection"]],
    ["refunded", true, []],
    ["replaced", true, []],
    ["declined", null, []],
    ["cancelled", null, []],
  ] as const)("offers only the allowed actions for %s (goods required: %s)", (status, goodsRequired, expected) => {
    view(detail({ status, goodsRequired, finalResolution: status === "requested" ? null : "refund" }));

    expect(buttons()).toEqual(expected);
  });

  it("offers Mark replaced, not Mark refunded, once Staff chose a replacement", () => {
    view(detail({ status: "approved", goodsRequired: false, finalResolution: "replacement" }));
    expect(buttons()).toEqual(["Mark replaced"]);
    cleanup();

    view(detail({ status: "goods received", goodsRequired: true, finalResolution: "replacement" }));
    expect(buttons()).toEqual(["Mark replaced", "Save inspection"]);
  });

  it("shows the preferred and final Resolution", () => {
    view(detail({ status: "approved", goodsRequired: false, preferredResolution: "refund", finalResolution: "replacement" }));

    expect(screen.getByText("Customer preferred: Refund")).toBeTruthy();
    expect(screen.getByText("Staff decided: Replacement")).toBeTruthy();
  });

  it("shows only the preference before Staff decide", () => {
    view(detail({ preferredResolution: "replacement" }));

    expect(screen.getByText("Customer preferred: Replacement")).toBeTruthy();
    expect(screen.queryByText(/Staff decided/)).toBeNull();
  });

  it("shows the evidence video, or says there is none", () => {
    const { container } = view(detail({ videoFileId: "vid-1" }), undefined, undefined, { videoUrl: "https://files/vid-1" });

    expect(container.querySelector("video")?.getAttribute("src")).toBe("https://files/vid-1");
    cleanup();

    view(detail());
    expect(screen.getByText("No video.")).toBeTruthy();
  });

  it("says a video that could not be reached could not be loaded", () => {
    view(detail({ videoFileId: "vid-1" }), undefined, undefined, { videoUrl: null });

    expect(screen.getByText(/The video could not be loaded/)).toBeTruthy();
  });

  it("shows the refund proof once refunded, and nothing before", () => {
    view(detail({ status: "refunded", finalResolution: "refund", refundProofFileId: "proof-1" }), undefined, undefined, {
      refundProofUrl: "https://files/proof-1",
    });

    expect(screen.getByAltText("Refund proof for RMA-15").getAttribute("src")).toBe("https://files/proof-1");
    cleanup();

    view(detail());
    expect(screen.queryByText("Refund proof")).toBeNull();
  });

  it("shows a decline reason on a declined Return", () => {
    view(detail({ status: "declined", declineReason: "Photos show normal wear" }));

    expect(screen.getByText("Declined: Photos show normal wear")).toBeTruthy();
  });
});

describe("approving", () => {
  const open = () => {
    view(detail());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    return screen.getByRole("alertdialog");
  };

  it("cannot be confirmed until Staff say whether the goods must come back", () => {
    const dialog = open();

    expect((within(dialog).getByRole("button", { name: "Approve Return" }) as HTMLButtonElement).disabled).toBe(true);
    expect(approveReturn).not.toHaveBeenCalled();
  });

  it.each([
    ["Yes, the Customer returns the goods", true],
    ["No, refund without the goods", false],
  ])("sends the choice %s", async (label, goodsRequired) => {
    vi.mocked(approveReturn).mockResolvedValue({ ok: true, return: { id: 15, status: "approved" } });
    const dialog = open();

    fireEvent.click(within(dialog).getByLabelText(label));
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve Return" }));

    await waitFor(() => expect(approveReturn).toHaveBeenCalledWith(15, goodsRequired, "refund"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("RMA-15 approved."));
  });

  it.each(["refund", "replacement"] as const)("defaults the Resolution to the Customer's preference (%s)", async (preferred) => {
    vi.mocked(approveReturn).mockResolvedValue({ ok: true, return: { id: 15, status: "approved" } });
    view(detail({ preferredResolution: preferred }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("alertdialog");

    expect((within(dialog).getByLabelText(new RegExp(`^${preferred}`, "i")) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByLabelText("No, refund without the goods"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve Return" }));

    await waitFor(() => expect(approveReturn).toHaveBeenCalledWith(15, false, preferred));
  });

  it("sends a Resolution that differs from the preference", async () => {
    vi.mocked(approveReturn).mockResolvedValue({ ok: true, return: { id: 15, status: "approved" } });
    const dialog = open();

    fireEvent.click(within(dialog).getByLabelText(/^replacement/i));
    fireEvent.click(within(dialog).getByLabelText("Yes, the Customer returns the goods"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve Return" }));

    await waitFor(() => expect(approveReturn).toHaveBeenCalledWith(15, true, "replacement"));
  });
});

describe("declining", () => {
  const open = () => {
    view(detail());
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    return screen.getByRole("alertdialog");
  };

  it("cannot be confirmed without a reason, even a blank one", () => {
    const dialog = open();
    const confirm = within(dialog).getByRole("button", { name: "Decline Return" }) as HTMLButtonElement;

    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "   " } });
    expect(confirm.disabled).toBe(true);
  });

  it("sends the reason", async () => {
    vi.mocked(declineReturn).mockResolvedValue({ ok: true, return: { id: 15, status: "declined" } });
    const dialog = open();

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Normal wear" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Decline Return" }));

    await waitFor(() => expect(declineReturn).toHaveBeenCalledWith(15, "Normal wear"));
  });
});

describe("goods received and refunded", () => {
  it("asks before marking goods received", async () => {
    vi.mocked(markReturnGoodsReceived).mockResolvedValue({ ok: true, return: { id: 15, status: "goods received" } });
    view(detail({ status: "approved", goodsRequired: true }));

    fireEvent.click(screen.getByRole("button", { name: "Mark goods received" }));
    expect(markReturnGoodsReceived).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark received" }));

    await waitFor(() => expect(markReturnGoodsReceived).toHaveBeenCalledWith(15));
  });

  const refundable = () => detail({ status: "goods received", goodsRequired: true, finalResolution: "refund" });
  const attach = (file: File) =>
    fireEvent.change(within(screen.getByRole("alertdialog")).getByLabelText("Refund proof"), { target: { files: [file] } });
  const confirmRefund = () =>
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^(Mark refunded|Refund ₱)/ }));

  it("cannot mark refunded until a refund proof is attached", () => {
    view(refundable());

    fireEvent.click(screen.getByRole("button", { name: "Issue refund" }));
    const confirm = within(screen.getByRole("alertdialog")).getByRole("button", { name: /^(Mark refunded|Refund ₱)/ }) as HTMLButtonElement;

    expect(confirm.disabled).toBe(true);
    expect(markReturnRefunded).not.toHaveBeenCalled();
  });

  it("refuses a proof that is not a JPG or PNG", () => {
    view(refundable());

    fireEvent.click(screen.getByRole("button", { name: "Issue refund" }));
    attach(picture("proof.gif", "image/gif"));

    expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toBeTruthy();
    expect((within(screen.getByRole("alertdialog")).getByRole("button", { name: /^(Mark refunded|Refund ₱)/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks before marking refunded, and sends the proof", async () => {
    vi.mocked(markReturnRefunded).mockResolvedValue({ ok: true, return: { id: 15, status: "refunded" } });
    view(refundable());

    fireEvent.click(screen.getByRole("button", { name: "Issue refund" }));
    attach(picture());
    expect(markReturnRefunded).not.toHaveBeenCalled();
    confirmRefund();

    await waitFor(() => expect(markReturnRefunded).toHaveBeenCalledTimes(1));
    const [id, form] = vi.mocked(markReturnRefunded).mock.calls[0];
    expect(id).toBe(15);
    expect((form as FormData).get("proof")).toBe("confirmed-image");
  });

  it("asks before marking replaced", async () => {
    vi.mocked(markReturnReplaced).mockResolvedValue({ ok: true, return: { id: 15, status: "replaced" } });
    view(detail({ status: "approved", goodsRequired: false, finalResolution: "replacement" }));

    fireEvent.click(screen.getByRole("button", { name: "Mark replaced" }));
    expect(markReturnReplaced).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark replaced" }));

    await waitFor(() => expect(markReturnReplaced).toHaveBeenCalledWith(15));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("RMA-15 marked replaced."));
  });

  it("shows a refusal as an error and never as success", async () => {
    vi.mocked(markReturnRefunded).mockResolvedValue({ ok: false, reason: "Return already changed; refresh it before trying again." });
    view(refundable());

    fireEvent.click(screen.getByRole("button", { name: "Issue refund" }));
    attach(picture());
    confirmRefund();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Return already changed; refresh it before trying again."));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("treats an action that never answers as a failure", async () => {
    vi.mocked(markReturnRefunded).mockRejectedValue(new Error("offline"));
    view(refundable());

    fireEvent.click(screen.getByRole("button", { name: "Issue refund" }));
    attach(picture());
    confirmRefund();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("Issue refund dialog", () => {
  it("shows the Figma dialog: items, where the money goes back, the amount and the proof", () => {
    render(<ReturnActions id={15} number="RMA-15" status="goods received" goodsRequired preferredResolution="refund" finalResolution="refund"
      refund={{ customerName: "Maria Santos", amount: 39_900, paymentMethod: "maya", items: [{ name: "Ube Halaya · Tub", quantity: 1 }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Issue refund" }));
    const dialog = screen.getByRole("alertdialog", { name: "Issue refund" });
    expect(within(dialog).getByText(/RMA-15 · Maria Santos · paid ₱399\.00 via Maya/)).toBeTruthy();
    expect(within(dialog).getByText("Send back by Maya")).toBeTruthy();
    expect(within(dialog).getByText("Refund amount")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Refund ₱399.00" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Refund window", () => {
  const view = (role: "staff" | "manager" | "admin" | "ceo", overrides: Partial<ReturnDetail> = {}, windowRequest?: import("@/features/approvals/view").ApprovalView) =>
    render(<ReturnDetailView detail={detail({ orderStatus: "delivered", refundWindowEndsAt: new Date("2026-11-16T10:00:00Z"), ...overrides })} imageUrls={[]} role={role} windowRequest={windowRequest} />);

  it("lets a Manager extend with a reason, waiting for the server", async () => {
    vi.mocked(extendRefundWindow).mockResolvedValue({ ok: true, endsAt: new Date() });
    view("manager");
    fireEvent.click(screen.getByRole("button", { name: "Extend by 24 hours…" }));
    const dialog = screen.getByRole("alertdialog");
    expect((within(dialog).getByRole("button", { name: "Extend" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Travelling" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Extend" }));
    await waitFor(() => expect(extendRefundWindow).toHaveBeenCalledWith(1042, "Travelling", {}));
  });

  it("shows Staff Request approval, and Waiting once asked", async () => {
    vi.mocked(extendRefundWindow).mockResolvedValue({ ok: false, reason: "Waiting for approval" } as never);
    view("staff");
    expect(screen.queryByRole("button", { name: "Extend by 24 hours…" })).toBeNull();
    fireEvent.click(within(screen.getByRole("heading", { name: "Refund window" }).closest("section")!).getByRole("button", { name: "Request approval…" }));
    fireEvent.change(within(screen.getByRole("alertdialog")).getByLabelText(/Reason/), { target: { value: "Travelling" } });
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    cleanup();
    view("staff", {}, { id: "w1", action: "return.extend-window", targetId: "1042", status: "waiting-manager" } as never);
    expect(screen.getByText("Waiting for approval")).toBeTruthy();
  });

  it("offers nothing to Admin or CEO, or once it was extended", () => {
    view("admin"); expect(screen.queryByRole("button", { name: /Extend by|Request approval/ })).toBeNull(); cleanup();
    view("ceo"); expect(screen.queryByRole("button", { name: /Extend by|Request approval/ })).toBeNull(); cleanup();
    view("manager", { refundWindowExtendedAt: new Date() });
    expect(screen.queryByRole("button", { name: /Extend by/ })).toBeNull();
    expect(screen.getByText(/cannot be extended again/)).toBeTruthy();
  });

  it("links the Replacement Order", () => {
    view("manager", { replacementOrderId: 77 });
    expect(screen.getByRole("link", { name: "Order #77" }).getAttribute("href")).toBe("/orders/77");
  });
});
