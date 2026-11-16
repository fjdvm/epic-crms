// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { escalate, sendBack, takeEscalated } from "@/features/tickets/escalate-actions";
import type { EscalationRecord } from "@/features/tickets/escalate";
import { TicketDetailView } from "@/features/tickets/ticket-detail";
import type { TicketDetail } from "@/features/tickets/ticket";

import { someServiceLevel } from "./service-level-fixture";

vi.mock("@/features/tickets/actions", () => ({
  claim: vi.fn(), release: vi.fn(), reply: vi.fn(), resolve: vi.fn(), putOnHold: vi.fn(), takeOffHold: vi.fn(),
  liveUrl: vi.fn(async () => null),
}));
vi.mock("@/features/tickets/reassign-actions", () => ({
  reassignOne: vi.fn(), reassignAll: vi.fn(), reassignOptions: vi.fn(), absentTickets: vi.fn(),
}));
vi.mock("@/features/tickets/escalate-actions", () => ({ escalate: vi.fn(), takeEscalated: vi.fn(), sendBack: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), promise: vi.fn() }) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const ticket: TicketDetail = {
  id: 208, subject: "Leaking pouch", status: "open", priority: "high", openedAt: new Date("2026-10-19T02:00:00Z"),
  claimerName: "Liza", claimerId: "liza", hold: null, serviceLevel: someServiceLevel(), messages: [], order: null,
  customer: { id: "c1", name: "Maria Santos", stage: "repeat", orders: 1, totalSpent: 0 },
};
const open: EscalationRecord = {
  id: 1, reason: "customer_upset", note: "Customer is very upset", escalatedByName: "Liza", at: new Date("2026-10-20T01:00:00Z"),
  resolution: null, resolutionNote: null, resolvedByName: null, resolvedAt: null,
};
const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent);

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Escalate" }));
  await user.click(screen.getByLabelText("Money decision"));
  await user.type(screen.getByLabelText(/Note for the Manager/), "Over the limit");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Escalate" }));
}

describe("Escalate on the Ticket page", () => {
  it("is offered to the Claimer only", () => {
    render(<TicketDetailView ticket={ticket} viewerId="liza" />);
    expect(buttons()).toContain("Escalate");
    cleanup();
    render(<TicketDetailView ticket={ticket} viewerId="carlo" />);
    expect(buttons()).not.toContain("Escalate");
    cleanup();
    render(<TicketDetailView ticket={{ ...ticket, claimerId: null, claimerName: null }} viewerId="liza" />);
    expect(buttons()).not.toContain("Escalate");
  });

  it("needs a reason and a note before anything is sent", async () => {
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="liza" />);

    await user.click(screen.getByRole("button", { name: "Escalate" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Escalate" }));

    expect(screen.getByText("Choose why you are escalating.")).toBeTruthy();
    expect(screen.getByText("Write a short note.")).toBeTruthy();
    expect(escalate).not.toHaveBeenCalled();
  });

  it("shows Escalated at once, keeps the Claimer, and hides Escalate and Release", async () => {
    vi.mocked(escalate).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="liza" />);

    await fillAndSubmit(user);

    expect(escalate).toHaveBeenCalledWith(208, "money", "Over the limit", expect.any(String));
    expect(screen.getAllByText("Escalated").length).toBeGreaterThan(0);
    expect(screen.getByText(/Claimed by Liza/)).toBeTruthy();
    expect(buttons()).not.toContain("Escalate");
    expect(buttons()).not.toContain("Release");
  });

  it("rolls back and says why when the server refuses", async () => {
    vi.mocked(escalate).mockResolvedValue({ ok: false, reason: "not-claimer" });
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="liza" />);

    await fillAndSubmit(user);

    await waitFor(() => expect(buttons()).toContain("Escalate"));
    expect(screen.queryByRole("region", { name: "Escalated" })).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Only the Staff member who claimed this Ticket can escalate it.");
  });

  it("rolls back with a plain message when the server never answers", async () => {
    vi.mocked(escalate).mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="liza" />);

    await fillAndSubmit(user);

    await waitFor(() => expect(buttons()).toContain("Escalate"));
    expect(toast.error).toHaveBeenCalledWith("CREOMS could not save that. Try again in a moment.");
  });
});

describe("An escalated Ticket", () => {
  it("shows the badge, reason and note to every Staff member, with no Manager buttons", () => {
    render(<TicketDetailView ticket={ticket} viewerId="carlo" escalations={[open]} />);

    const summary = screen.getByRole("region", { name: "Escalated" });
    expect(within(summary).getByText(/Customer upset/)).toBeTruthy();
    expect(within(summary).getByText("Customer is very upset")).toBeTruthy();
    expect(buttons()).not.toContain("Take ticket");
    expect(buttons()).not.toContain("Send back");
  });

  it("offers a Manager Take ticket and Send back, and the Claimer neither", () => {
    render(<TicketDetailView ticket={ticket} viewerId="mara" canReassign escalations={[open]} />);
    expect(buttons()).toEqual(expect.arrayContaining(["Take ticket", "Send back"]));
    cleanup();
    render(<TicketDetailView ticket={ticket} viewerId="liza" escalations={[open]} />);
    expect(buttons()).not.toContain("Take ticket");
  });

  it("confirms first, then makes the Manager the Claimer and clears the badge at once", async () => {
    vi.mocked(takeEscalated).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="mara" viewerName="Mara" canReassign escalations={[open]} />);

    await user.click(screen.getByRole("button", { name: "Take ticket" }));
    expect(takeEscalated).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Take ticket" }));

    expect(takeEscalated).toHaveBeenCalledWith(208, expect.any(String));
    expect(screen.getByText(/Claimed by Mara/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Escalated" })).toBeNull();
  });

  it("rolls a refused take back, badge and Claimer, with the reason", async () => {
    vi.mocked(takeEscalated).mockResolvedValue({ ok: false, reason: "claimer-changed" });
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="mara" viewerName="Mara" canReassign escalations={[open]} />);

    await user.click(screen.getByRole("button", { name: "Take ticket" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Take ticket" }));

    await waitFor(() => expect(screen.getByText(/Claimed by Liza/)).toBeTruthy());
    expect(screen.getByRole("region", { name: "Escalated" })).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith("Someone else changed who holds this Ticket first. Reload to see who has it now.");
  });

  it("needs a note to send back, then clears the badge at once and keeps the Claimer", async () => {
    vi.mocked(sendBack).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="mara" canReassign escalations={[open]} />);

    await user.click(screen.getByRole("button", { name: "Send back" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Send back" }));
    expect(screen.getByText("Write a note.")).toBeTruthy();
    expect(sendBack).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/^Note/), "Offer a voucher");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Send back" }));

    expect(sendBack).toHaveBeenCalledWith(208, "Offer a voucher", expect.any(String));
    expect(screen.queryByRole("region", { name: "Escalated" })).toBeNull();
    expect(screen.getByText(/Claimed by Liza/)).toBeTruthy();
  });

  it("lists the escalation and what the Manager did in the activity", () => {
    const done: EscalationRecord = {
      ...open, resolution: "sent_back", resolutionNote: "Offer a voucher", resolvedByName: "Mara", resolvedAt: new Date("2026-10-20T02:00:00Z"),
    };
    render(<TicketDetailView ticket={ticket} viewerId="ceo" escalations={[done]} />);

    const activity = screen.getByRole("region", { name: "Activity" });
    expect(within(activity).getByText("Liza escalated this Ticket: Customer upset")).toBeTruthy();
    expect(within(activity).getByText("Mara sent this Ticket back to its Claimer")).toBeTruthy();
    expect(within(activity).getByText("Note: Offer a voucher")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Escalated" })).toBeNull();
  });
});
