// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReturnDetailView } from "@/features/returns/return-detail";
import type { ReturnDetail } from "@/features/returns/returns";

const { refresh, toast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/returns/actions", () => ({
  approveReturn: vi.fn(),
  declineReturn: vi.fn(),
  markReturnGoodsReceived: vi.fn(),
  markReturnRefunded: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

import { approveReturn, declineReturn, markReturnGoodsReceived, markReturnRefunded } from "@/features/returns/actions";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const detail = (overrides: Partial<ReturnDetail> = {}): ReturnDetail => ({
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
  refundWindowEndsAt: null,
  images: [{ fileId: "img-1", position: 0 }],
  history: [
    { status: "requested", actor: { type: "customer", id: "c1", name: "Maria Santos" }, at: new Date("2026-10-20T01:00:00Z"), note: null },
  ],
  ...overrides,
});

const view = (d: ReturnDetail, urls: (string | null)[] = ["https://files/img-1"], photo: string | null | undefined = "https://files/photo-1") =>
  render(<ReturnDetailView detail={d} imageUrls={urls} deliveryPhotoUrl={photo} />);

const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent);

describe("the Return detail", () => {
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
    ["approved", false, ["Mark refunded"]],
    ["goods received", true, ["Mark refunded"]],
    ["refunded", true, []],
    ["declined", null, []],
    ["cancelled", null, []],
  ] as const)("offers only the allowed actions for %s (goods required: %s)", (status, goodsRequired, expected) => {
    view(detail({ status, goodsRequired }));

    expect(buttons()).toEqual(expected);
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

    await waitFor(() => expect(approveReturn).toHaveBeenCalledWith(15, goodsRequired));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("RMA-15 approved."));
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

  it("asks before marking refunded", async () => {
    vi.mocked(markReturnRefunded).mockResolvedValue({ ok: true, return: { id: 15, status: "refunded" } });
    view(detail({ status: "goods received", goodsRequired: true }));

    fireEvent.click(screen.getByRole("button", { name: "Mark refunded" }));
    expect(markReturnRefunded).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark refunded" }));

    await waitFor(() => expect(markReturnRefunded).toHaveBeenCalledWith(15));
  });

  it("shows a refusal as an error and never as success", async () => {
    vi.mocked(markReturnRefunded).mockResolvedValue({ ok: false, reason: "Return already changed; refresh it before trying again." });
    view(detail({ status: "goods received", goodsRequired: true }));

    fireEvent.click(screen.getByRole("button", { name: "Mark refunded" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark refunded" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Return already changed; refresh it before trying again."));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("treats an action that never answers as a failure", async () => {
    vi.mocked(markReturnRefunded).mockRejectedValue(new Error("offline"));
    view(detail({ status: "goods received", goodsRequired: true }));

    fireEvent.click(screen.getByRole("button", { name: "Mark refunded" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark refunded" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
