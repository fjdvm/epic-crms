// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, toast } = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/features/files/client", () => ({ uploadFile: vi.fn() }));
vi.mock("@/features/approvals/actions", () => ({ decideApproval: vi.fn() }));
vi.mock("@/features/returns/actions", () => ({
  approveReturn: vi.fn(), declineReturn: vi.fn(), decideReturn: vi.fn(), requestReturnDecision: vi.fn(), markReturnGoodsReceived: vi.fn(), markReturnRefunded: vi.fn(), markReturnReplaced: vi.fn(),
}));

import { ApprovalsList } from "@/features/approvals/approvals-list";
import { decideApproval } from "@/features/approvals/actions";
import { idCheckToView, kindOf, type ApprovalView } from "@/features/approvals/view";
import { ReturnActions } from "@/features/returns/return-actions";
import { RoleStrip } from "@/features/dashboard/role-strip";
import { approveReturn, markReturnRefunded, requestReturnDecision } from "@/features/returns/actions";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const NOW = Date.parse("2026-11-15T10:00:00Z");
const request = (o: Partial<ApprovalView> = {}): ApprovalView => ({
  id: "r1", action: "return.refund", targetId: "15", amountInCentavos: 39_900, limitInCentavos: 500_000, reason: "Replacement is too late",
  requesterId: "ana", requesterName: "Ana", status: "waiting-manager", requestedAt: "2026-11-15T09:35:00Z",
  managerName: null, ceoName: null, declineReason: null, ...o,
});

describe("Staff Request approval", () => {
  const actions = (requests: ApprovalView[] = []) => render(
    <ReturnActions id={15} number="RMA-15" status="requested" goodsRequired={null} preferredResolution="refund" finalResolution={null} role="staff" requests={requests} />);

  it("shows Request approval · decide return instead of the outcome buttons, with the window and photo check", async () => {
    vi.mocked(requestReturnDecision).mockResolvedValue({ ok: true, approvalId: "r1" });
    render(<ReturnActions id={15} number="RMA-15" status="requested" goodsRequired={null} preferredResolution="refund" finalResolution={null} role="staff" inWindow reasonLabel="Damaged" />);
    expect(screen.queryByRole("button", { name: "Decide return" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Request approval · decide return" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Requested within the Refund window")).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText("Yes, the photo shows it"));
    fireEvent.change(within(dialog).getByLabelText(/Note for the Manager/), { target: { value: "Photos match" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(requestReturnDecision).toHaveBeenCalledWith(15, { photoSupportsReason: true, note: "Photos match" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(approveReturn).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says when the request came after the window", () => {
    render(<ReturnActions id={15} number="RMA-15" status="requested" goodsRequired={null} preferredResolution="refund" finalResolution={null} role="staff" inWindow={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Request approval · decide return" }));
    expect(within(screen.getByRole("alertdialog")).getByText("Requested after the Refund window closed")).toBeTruthy();
  });

  it("cannot send without the photo check and a note", () => {
    actions();
    fireEvent.click(screen.getByRole("button", { name: "Request approval · decide return" }));
    const dialog = screen.getByRole("alertdialog");
    const send = within(dialog).getByRole("button", { name: "Send request" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Note for the Manager/), { target: { value: "Photos match" } });
    expect(send.disabled).toBe(true);
    fireEvent.click(within(dialog).getByLabelText("No, or it is unclear"));
    expect(send.disabled).toBe(false);
  });

  it("says why when the request is refused", async () => {
    vi.mocked(requestReturnDecision).mockResolvedValue({ ok: false, reason: "A Manager was already asked to decide this Return." });
    actions();
    fireEvent.click(screen.getByRole("button", { name: "Request approval · decide return" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByLabelText("Yes, the photo shows it"));
    fireEvent.change(within(dialog).getByLabelText(/Note for the Manager/), { target: { value: "Photos match" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows Waiting for approval, not the button, once requested", () => {
    actions([request()]);
    expect(screen.getByText("Waiting for approval")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request approval · decide return" })).toBeNull();
  });

  it("lets Staff finish an approved refund with that approval", async () => {
    vi.mocked(markReturnRefunded).mockResolvedValue({ ok: true } as never);
    render(<ReturnActions id={15} number="RMA-15" status="approved" goodsRequired={false} preferredResolution="refund" finalResolution="refund" role="staff" requests={[request({ status: "approved" })]} />);
    expect(screen.getByRole("button", { name: "Save refund proof" })).toBeTruthy();
  });

  it("shows no actions to Admin or CEO", () => {
    render(<ReturnActions id={15} number="RMA-15" status="requested" goodsRequired={null} preferredResolution="refund" finalResolution={null} role="admin" />);
    expect(screen.getByText("View only")).toBeTruthy();
  });
});

describe("Manager approvals list", () => {
  const list = (requests: ApprovalView[], role: "manager" | "ceo" | "admin" = "manager") => render(<ApprovalsList requests={requests} role={role} now={NOW} />);

  it("shows waiting requests with a stats strip", () => {
    list([request(), request({ id: "r2", action: "return.replace", amountInCentavos: 10_000 })]);
    expect(screen.getByText("Refund ·", { exact: false })).toBeTruthy();
    expect(screen.getByText("₱499")).toBeTruthy();
    expect(screen.getByText("Oldest 25 min")).toBeTruthy();
  });

  it("declines optimistically and rolls back with the reason when the server refuses", async () => {
    vi.mocked(decideApproval).mockResolvedValue({ ok: false, reason: "Approval request was not found." });
    list([request({ action: "return.replace", amountInCentavos: 0 })]);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Not eligible" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Decline request" }));
    await waitFor(() => expect(decideApproval).toHaveBeenCalledWith("Returns", "r1", "decline", "Not eligible"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Approval request was not found."));
    await waitFor(() => expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy());
  });

  it("does not approve a refund optimistically: it waits for the server", async () => {
    let finish!: (v: { ok: true }) => void;
    vi.mocked(decideApproval).mockReturnValue(new Promise((resolve) => { finish = resolve as never; }) as never);
    list([request()]);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve request" }));
    await screen.findByText("Approving…");
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryAllByText(/^Approved by/)).toHaveLength(0);
    finish({ ok: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("gives the CEO only the final step, and Admin no buttons", () => {
    const { unmount } = list([request({ status: "waiting-manager" })], "ceo");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    unmount();
    list([request({ status: "waiting-ceo", amountInCentavos: 500_001 })], "ceo");
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    cleanup();
    list([request()], "admin");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("filters by tab", () => {
    list([request(), request({ id: "r3", status: "declined", declineReason: "No" })]);
    fireEvent.click(screen.getByRole("tab", { name: "Declined" }));
    expect(screen.getByText("Declined: No")).toBeTruthy();
  });
});

describe("Role strips on the Dashboard", () => {
  it("shows each Role its own strip", () => {
    const { unmount } = render(<RoleStrip role="manager" requests={[request()]} now={NOW} />);
    expect(screen.getByText("1 approval waiting for you")).toBeTruthy();
    unmount();
    render(<RoleStrip role="staff" requests={[request()]} now={NOW} />);
    expect(screen.getByText("My work today")).toBeTruthy();
    cleanup();
    render(<RoleStrip role="ceo" requests={[request({ status: "waiting-ceo" })]} now={NOW} />);
    expect(screen.getByText(/over the Approval limit waiting for you/)).toBeTruthy();
    cleanup();
    render(<RoleStrip role="admin" requests={[]} now={NOW} />);
    expect(screen.getByText(/every module is read-only/)).toBeTruthy();
  });
});

describe("Approvals by type", () => {
  const list = (requests: ApprovalView[], role: "staff" | "manager" | "ceo" | "admin" = "manager", initialKind?: "id-check") =>
    render(<ApprovalsList requests={requests} role={role} now={NOW} initialKind={initialKind} />);
  const idCheck = idCheckToView({ id: 7, customerName: "Maria Santos", idType: "senior", status: "pending", submittedAt: new Date(NOW - 3_600_000), decidedByName: null, declineReason: null });
  const payment = request({ id: "p1", action: "payment.approve-anyway", module: "Payments", targetId: "1046", amountInCentavos: 0 });

  it("sorts each action into its type", () => {
    expect(["return.refund", "payment.approve-anyway", "order.cancel-after-dispatch", "order.cancel-settle", "write-off", "return.replace", "id-check"].map(a => kindOf(a as never)))
      .toEqual(["refund", "payment", "cancellation", "cancellation", "write-off", "return", "id-check"]);
  });

  it("groups rows under a heading per type, with counts on the type filter", () => {
    list([request(), payment, idCheck]);
    expect(screen.getByRole("region", { name: "Refunds" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Payments" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "ID checks" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /ID checks 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /All types 3/ })).toBeTruthy();
  });

  it("narrows to one type", () => {
    list([request(), payment, idCheck]);
    fireEvent.click(screen.getByRole("button", { name: /Payments/ }));
    expect(screen.getByRole("region", { name: "Payments" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Refunds" })).toBeNull();
  });

  it("opens on the ID checks from the address", () => {
    list([request(), idCheck], "staff", "id-check");
    expect(screen.getByRole("region", { name: "ID checks" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Refunds" })).toBeNull();
  });

  it("links a payment to its Order and an ID check to its review page, and Staff get Review", () => {
    list([payment, idCheck], "staff");
    expect(screen.getByRole("link", { name: "BR-1046" }).getAttribute("href")).toBe("/orders/1046");
    expect(screen.getByRole("link", { name: "ID check #7" }).getAttribute("href")).toBe("/customer-profiles/senior-pwd/7");
    expect(screen.getByRole("link", { name: "Review" }).getAttribute("href")).toBe("/customer-profiles/senior-pwd/7");
  });

  it("decides a payment under its own Module, not Returns", async () => {
    vi.mocked(decideApproval).mockResolvedValue({ ok: true } as never);
    list([payment]);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve request" }));
    await waitFor(() => expect(decideApproval).toHaveBeenCalledWith("Payments", "p1", "approve"));
  });

  it("gives Admin and the CEO View, not Review, on an ID check", () => {
    list([idCheck], "admin");
    expect(screen.getByRole("link", { name: "View" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Review" })).toBeNull();
  });
});

describe("a decide-return request on the Approvals list", () => {
  it("sends the Manager to the Return to pick the outcome, with no Approve button", () => {
    render(<ApprovalsList requests={[request({ action: "return.decide", reason: "Photos match" })]} role="manager" now={NOW} />);
    expect(screen.getByText(/Decide return/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Return to decide" }).getAttribute("href")).toBe("/returns/15");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
