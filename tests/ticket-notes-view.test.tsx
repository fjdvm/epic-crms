// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addNote } from "@/features/tickets/actions";
import type { TicketDetail } from "@/features/tickets/ticket";
import { TicketDetailView } from "@/features/tickets/ticket-detail";

import { someServiceLevel } from "./service-level-fixture";

vi.mock("@/features/tickets/actions", () => ({
  claim: vi.fn(), release: vi.fn(), reply: vi.fn(), resolve: vi.fn(), putOnHold: vi.fn(), takeOffHold: vi.fn(),
  addNote: vi.fn(), liveUrl: vi.fn(async () => null),
}));
vi.mock("@/features/tickets/reassign-actions", () => ({
  reassignOne: vi.fn(), assignTicket: vi.fn(), reassignAll: vi.fn(), reassignOptions: vi.fn(), absentTickets: vi.fn(),
}));
vi.mock("@/features/tickets/escalate-actions", () => ({ escalate: vi.fn(), takeEscalated: vi.fn(), sendBack: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), promise: vi.fn() }) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const ticket: TicketDetail = {
  id: 208, subject: "Leaking pouch", status: "open", category: "Order Issue", priority: "high", openedAt: new Date("2026-10-19T02:00:00Z"),
  claimerName: "Liza", claimerId: "liza", hold: null, serviceLevel: someServiceLevel(), rating: null, followUpOf: null, followUps: [],
  messages: [
    { id: 1, sender: "customer", senderName: "Maria", body: "It leaks", hasAttachment: false, createdAt: new Date("2026-10-19T02:00:00Z") },
    { id: 2, sender: "staff", senderName: "Carlo", body: "Courier lost the box", internal: true, hasAttachment: false, createdAt: new Date("2026-10-19T03:00:00Z") },
  ],
  order: null, customer: { id: "c1", name: "Maria Santos", stage: "repeat", orders: 1, totalSpent: 0 },
};

async function write(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole("button", { name: "Add internal note" }));
  await user.type(screen.getByLabelText(/Internal note/), text);
  await user.click(screen.getByRole("button", { name: "Add note" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Add note" }));
}

describe("Internal notes on the Ticket page", () => {
  it("shows a note apart from the replies, labelled with the writer and as Staff-only", () => {
    const { container } = render(<TicketDetailView ticket={ticket} viewerId="bernice" canNote />);

    const note = container.querySelector("[data-internal-note]") as HTMLElement;
    expect(note.textContent).toContain("Internal note · only Staff see this");
    expect(note.textContent).toContain("Courier lost the box");
    expect(note.textContent).toContain("Carlo");
  });

  it("offers the note box to any Staff member, claimer or not, and to nobody who can only view", () => {
    render(<TicketDetailView ticket={ticket} viewerId="bernice" canNote />);
    expect(screen.getByRole("button", { name: "Add internal note" })).toBeTruthy();
    cleanup();
    render(<TicketDetailView ticket={ticket} viewerId="bernice" />);
    expect(screen.queryByRole("button", { name: "Add internal note" })).toBeNull();
    // A read-only Role still reads the notes.
    expect(screen.getByText("Courier lost the box")).toBeTruthy();
  });

  it("asks to confirm, then shows the note at once as sending, before the server answers", async () => {
    vi.mocked(addNote).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="bernice" viewerName="Bernice" canNote />);

    await user.click(screen.getByRole("button", { name: "Add internal note" }));
    await user.type(screen.getByLabelText(/Internal note/), "Called the courier");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(addNote).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Add note" }));

    expect(addNote).toHaveBeenCalledWith(208, "Called the courier");
    expect(screen.getByText("Called the courier")).toBeTruthy();
    expect(screen.getByText(/sending…/)).toBeTruthy();
  });

  it("rolls the note back with the reason when the server refuses, and gives the words back", async () => {
    vi.mocked(addNote).mockResolvedValue({ ok: false, reason: "read-only" });
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="bernice" viewerName="Bernice" canNote />);

    await write(user, "Called the courier");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Your Role can only view shop work."));
    await waitFor(() => expect((screen.getByLabelText(/Internal note/) as HTMLTextAreaElement).value).toBe("Called the courier"));
    expect(screen.getAllByText("Called the courier")).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the note and refreshes when the server saves it", async () => {
    vi.mocked(addNote).mockResolvedValue({ ok: true, messageId: 9 });
    const user = userEvent.setup();
    render(<TicketDetailView ticket={ticket} viewerId="bernice" viewerName="Bernice" canNote />);

    await write(user, "Called the courier");

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByText("Called the courier")).toBeTruthy();
    expect(screen.queryByText(/sending…/)).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
