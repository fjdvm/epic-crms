// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { absentTickets, reassignAll, reassignOne, reassignOptions } from "@/features/tickets/reassign-actions";
import { ReassignAllDialog } from "@/features/tickets/reassign-dialog";
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
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), promise: vi.fn() }) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const ticket: TicketDetail = {
  id: 208, subject: "Leaking pouch", status: "open", priority: "high", openedAt: new Date("2026-10-19T02:00:00Z"),
  claimerName: "Liza", claimerId: "liza", hold: null, serviceLevel: someServiceLevel(), messages: [], order: null,
  customer: { id: "c1", name: "Maria Santos", stage: "repeat", orders: 1, totalSpent: 0 },
};
const teammates = [
  { id: "liza", name: "Liza", role: "staff" as const, open: 5 },
  { id: "rhea", name: "Rhea", role: "staff" as const, open: 3 },
];
const buttons = () => screen.queryAllByRole("button").map((b) => b.textContent);

describe("Reassign on the Ticket page", () => {
  it("shows the button to a Manager only", () => {
    render(<TicketDetailView ticket={ticket} viewerId="mara" canReassign />);
    expect(buttons()).toContain("Reassign");
    cleanup();
    render(<TicketDetailView ticket={ticket} viewerId="mara" />);
    expect(buttons()).not.toContain("Reassign");
  });

  it("requires a reason, then shows the new Claimer at once", async () => {
    vi.mocked(reassignOptions).mockResolvedValue({ ok: true, teammates });
    vi.mocked(reassignOne).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="mara" canReassign />);

    await user.click(screen.getByRole("button", { name: "Reassign" }));
    await user.click(await screen.findByLabelText(/Rhea/));
    await user.click(screen.getByRole("button", { name: "Reassign to Rhea" }));
    expect(screen.getByText("Write a reason.", { selector: "span[role=alert]" })).toBeTruthy();
    expect(reassignOne).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/^Reason/), "Liza is off today");
    await user.click(screen.getByRole("button", { name: "Reassign to Rhea" }));

    expect(reassignOne).toHaveBeenCalledWith(208, "liza", "rhea", "Liza is off today", expect.any(String));
    expect(screen.getByText(/Claimed by Rhea/)).toBeTruthy();
  });

  it("rolls back and says plainly when someone else moved it first", async () => {
    vi.mocked(reassignOptions).mockResolvedValue({ ok: true, teammates });
    vi.mocked(reassignOne).mockResolvedValue({ ok: false, reason: "claimer-changed" });
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="mara" canReassign />);

    await user.click(screen.getByRole("button", { name: "Reassign" }));
    await user.click(await screen.findByLabelText(/Rhea/));
    await user.type(screen.getByLabelText(/^Reason/), "Busy");
    await user.click(screen.getByRole("button", { name: "Reassign to Rhea" }));

    await waitFor(() => expect(screen.getByText(/Claimed by Liza/)).toBeTruthy());
    expect(toast.error).toHaveBeenCalledWith("Someone else changed who holds this Ticket first. Reload to see who has it now.");
  });

  it("rolls back with a plain message when the server never answers", async () => {
    vi.mocked(reassignOptions).mockResolvedValue({ ok: true, teammates });
    vi.mocked(reassignOne).mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="mara" canReassign />);

    await user.click(screen.getByRole("button", { name: "Reassign" }));
    await user.click(await screen.findByLabelText(/Rhea/));
    await user.type(screen.getByLabelText(/^Reason/), "Busy");
    await user.click(screen.getByRole("button", { name: "Reassign to Rhea" }));

    await waitFor(() => expect(screen.getByText(/Claimed by Liza/)).toBeTruthy());
    expect(toast.error).toHaveBeenCalledWith("CREOMS could not save that. Try again in a moment.");
  });

  it("shows a loading skeleton the moment the dialog opens", async () => {
    vi.mocked(reassignOptions).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="mara" canReassign />);

    await user.click(screen.getByRole("button", { name: "Reassign" }));
    expect(screen.getByLabelText("Loading Staff")).toBeTruthy();
  });

  it("lists every move in the activity, with the reason, for anyone who can open the Ticket", () => {
    render(
      <TicketDetailView ticket={ticket} viewerId="ceo" reassignments={[
        { id: 1, fromName: "Liza", toName: "Rhea", reason: "Liza is off", movedByName: "Mara", at: new Date("2026-10-20T01:00:00Z") },
      ]} />,
    );
    const activity = screen.getByRole("region", { name: "Activity" });
    expect(within(activity).getByText("Mara moved this Ticket from Liza to Rhea")).toBeTruthy();
    expect(within(activity).getByText("Reason: Liza is off")).toBeTruthy();
  });
});

describe("Reassign all", () => {
  it("shows the Tickets and the new workload before confirming, then moves them to one person", async () => {
    vi.mocked(reassignOptions).mockResolvedValue({ ok: true, teammates: [{ ...teammates[0], open: 2 }, teammates[1]] });
    vi.mocked(absentTickets).mockResolvedValue({ ok: true, tickets: [
      { id: 198, subject: "Pickup change", customerName: "Joy Ramos", status: "open" },
      { id: 201, subject: "Bulk order", customerName: "Pia Santos", status: "on_hold" },
    ] });
    vi.mocked(reassignAll).mockResolvedValue({ ok: true, moved: [198, 201], skipped: [] });
    const user = userEvent.setup();
    render(<ReassignAllDialog />);

    await user.click(screen.getByRole("button", { name: "Reassign all" }));
    await user.click(await screen.findByLabelText(/Liza/));
    const list = await screen.findByRole("region", { name: "Tickets to move" });
    expect(within(list).getByText(/TKT-198/)).toBeTruthy();
    expect(within(list).getByText(/TKT-201/)).toBeTruthy();

    await user.click(screen.getAllByLabelText(/Rhea/)[1]);
    expect(screen.getByText("Rhea: 3 open → 5 open")).toBeTruthy();
    await user.type(screen.getByLabelText(/^Reason/), "Liza is off today");
    await user.click(screen.getByRole("button", { name: "Move 2 Tickets" }));

    expect(reassignAll).toHaveBeenCalledWith([198, 201], "liza", "rhea", "Liza is off today", expect.any(String));
    expect(toast.promise).toHaveBeenCalled();
  });
});
