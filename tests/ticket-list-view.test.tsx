// @vitest-environment jsdom
import { someServiceLevel } from "./service-level-fixture";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assignTicket } from "@/features/tickets/reassign-actions";
import { TicketListView } from "@/features/tickets/ticket-list";
import type { TicketList, TicketRow } from "@/features/tickets/tickets";


vi.mock("@/features/tickets/reassign-actions", () => ({ assignTicket: vi.fn() }));
vi.mock("@/features/tickets/actions", () => ({ claim: vi.fn(), release: vi.fn(), reply: vi.fn(), resolve: vi.fn(), addNote: vi.fn(), listTicketNotes: vi.fn().mockResolvedValue({ ok: true, notes: [{ id: 1, authorName: "Bea", body: "Called the courier", at: "2026-10-20T01:00:00Z" }] }) }));
vi.mock("@/features/tickets/escalate-actions", () => ({ escalate: vi.fn(), sendBack: vi.fn(), takeEscalated: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

const row = (overrides: Partial<TicketRow>): TicketRow => ({
  id: 208,
  subject: "Halaya pouch arrived leaking",
  customerName: "Maria Santos",
  category: "Damaged item",
  claimedById: null,
  claimedByName: null,
  orderId: 1042,
  priority: "high",
  status: "open",
  waiting: false,
  overdue: false,
  escalated: false,
  createdAt: new Date("2026-10-19T00:00:00Z"),
  lastActivity: new Date("2026-10-20T00:00:00Z"),
  serviceLevel: someServiceLevel(),
  ...overrides,
});

function view(rows: TicketRow[]) {
  const list: TicketList = {
    rows,
    counts: { open: 7, waiting: 3, on_hold: 2, resolved: 9, completed: 119, all: 135, mine: 4, staffs: 0 },
    totalOpen: 7,
    overdue: 2,
    page: 1,
    pageSize: 25,
    totalPages: 1,
  };

  return render(<TicketListView list={list} params={{ tab: "open", page: 1 }} viewer={{ id: "me", name: "Me", role: "staff" }} />);
}

describe("the Tickets list as designed", () => {
  it("opens a Ticket in a drawer, with Claim only on an Unclaimed one", () => {
    view([row({ id: 208 }), row({ id: 207, claimedById: "staff-2", claimedByName: "Rhea" })]);

    expect(screen.getByText("Rhea")).toBeTruthy();
    expect(screen.getByText("Assign")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open TKT-208" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Claim" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open conversation" }).getAttribute("href")).toBe("/conversations?ticket=208&tab=unclaimed");
  });

  it("badges only the Tickets a Manager has been asked about", () => {
    view([row({ id: 208, escalated: true }), row({ id: 207 })]);

    expect(screen.getAllByText("Escalated")).toHaveLength(1);
  });

  it("shows each Ticket's Category on its details line", () => {
    view([row({ category: "Damaged item" })]);

    expect(screen.getByText(/Damaged item/)).toBeTruthy();
  });

  it("says nothing matched when a search or filter leaves no Tickets", () => {
    const list: TicketList = {
      rows: [],
      counts: { open: 0, waiting: 0, on_hold: 0, resolved: 0, completed: 0, all: 0, mine: 0, staffs: 0 },
      totalOpen: 7,
      overdue: 2,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    };

    render(<TicketListView list={list} params={{ tab: "open", page: 1, q: "nobody" }} />);

    expect(screen.getByText("No Tickets match this search and these filters.")).toBeTruthy();
  });

  it("keeps the search and filters when moving between tabs", () => {
    const list = { rows: [row({})], counts: { open: 1, waiting: 0, on_hold: 0, resolved: 0, completed: 0, all: 1, mine: 0, staffs: 0 }, totalOpen: 1, overdue: 0, page: 1, pageSize: 25, totalPages: 1 };

    render(<TicketListView list={list} params={{ tab: "open", page: 1, q: "maria", priority: "high", overdue: true }} />);

    expect(screen.getByRole("link", { name: "Mine 0" }).getAttribute("href")).toBe(
      "/tickets?tab=mine&q=maria&priority=high&overdue=1",
    );
  });

  it("has the six tabs with their counts and no Channel column", () => {
    view([row({})]);

    expect(screen.getByRole("link", { name: "Open 7" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Waiting on customer 3" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Resolved 9" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Completed 119" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All 135" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mine 4" })).toBeTruthy();
    expect(screen.queryByText("Channel")).toBeNull();
    for (const header of ["Details", "Service level", "Assigned", "Priority", "Activity status", "Status"]) {
      expect(screen.getByText(header)).toBeTruthy();
    }
  });

  it("shows the Ticket number, None yet, and a pill for each status", () => {
    view([
      row({ id: 208 }),
      row({ id: 205, orderId: null, priority: "normal", waiting: true }),
      row({ id: 203, priority: "normal", status: "resolved" }),
      row({ id: 202, priority: "normal", status: "completed" }),
      row({ id: 201, overdue: true }),
    ]);

    expect(screen.getByText("(#208) Halaya pouch arrived leaking")).toBeTruthy();
    expect(screen.getAllByText(/No order/)).toHaveLength(1);
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByText("Resolved")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
  });

  it("hides the Staffs tab from Staff and shows the people to a Manager", () => {
    const list = { rows: [], counts: { open: 0, waiting: 0, on_hold: 0, resolved: 0, completed: 0, all: 0, mine: 0, staffs: 2 }, totalOpen: 0, overdue: 0, page: 1, pageSize: 25, totalPages: 1 };
    const staffs = [{ id: "rhea", name: "Rhea", role: "staff" as const, open: 3 }];

    render(<TicketListView list={list} params={{ tab: "staffs", page: 1 }} viewer={{ id: "s", name: "S", role: "staff" }} staffs={staffs} />);
    expect(screen.queryByRole("link", { name: "Staffs 2" })).toBeNull();
    cleanup();

    render(<TicketListView list={list} params={{ tab: "staffs", page: 1 }} viewer={{ id: "m", name: "M", role: "manager" }} staffs={staffs} />);
    expect(screen.getByRole("link", { name: "Staffs 2" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Rhea/ }).getAttribute("href")).toBe("/tickets?tab=staffs&claimed=rhea");
  });

  it("lets a Manager assign from the drawer, and tells Staff to request approval", () => {
    const staffs = [{ id: "rhea", name: "Rhea", role: "staff" as const, open: 3 }];
    const held = row({ id: 207, claimedById: "staff-2", claimedByName: "Bea" });
    const list = { rows: [held], counts: { open: 0, waiting: 0, on_hold: 0, resolved: 0, completed: 0, all: 0, mine: 0, staffs: 1 }, totalOpen: 1, overdue: 0, page: 1, pageSize: 25, totalPages: 1 };

    render(<TicketListView list={list} params={{ tab: "all", page: 1 }} viewer={{ id: "m", name: "M", role: "manager" }} staffs={staffs} />);
    fireEvent.click(screen.getByRole("button", { name: "Open TKT-207" }));
    expect(screen.getByRole("combobox", { name: "Assign to" })).toBeTruthy();
    cleanup();

    render(<TicketListView list={list} params={{ tab: "all", page: 1 }} viewer={{ id: "s", name: "S", role: "staff" }} staffs={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open TKT-207" }));
    expect(screen.queryByRole("combobox", { name: "Assign to" })).toBeNull();
    expect(screen.getByText(/Request approval/)).toBeTruthy();
    // Someone else's Ticket is not Staff's to read.
    expect(screen.queryByRole("link", { name: "Open conversation" })).toBeNull();
  });

  it("confirms before assigning from the drawer, and rolls back with the reason when refused", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(assignTicket).mockResolvedValue({ ok: false, reason: "claimer-changed" });
    const staffs = [{ id: "rhea", name: "Rhea", role: "staff" as const, open: 3 }];
    const list = { rows: [row({ id: 207 })], counts: { open: 1, waiting: 0, on_hold: 0, resolved: 0, completed: 0, all: 1, mine: 0, staffs: 0 }, totalOpen: 1, overdue: 0, page: 1, pageSize: 25, totalPages: 1 };

    render(<TicketListView list={list} params={{ tab: "open", page: 1 }} viewer={{ id: "m", name: "M", role: "manager" }} staffs={staffs} />);
    fireEvent.click(screen.getByRole("button", { name: "Open TKT-207" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Assign to" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Rhea/ }));
    expect(assignTicket).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(assignTicket).toHaveBeenCalledWith(207, null, "rhea", "", expect.any(String));
    await screen.findByText("Unassigned");
  });

  it("opens an unclaimed Ticket's Conversation from the Unclaimed inbox", () => {
    view([row({ id: 208 })]);
    fireEvent.click(screen.getByRole("button", { name: "Open TKT-208" }));

    expect(screen.getByRole("link", { name: "Open conversation" }).getAttribute("href")).toBe("/conversations?ticket=208&tab=unclaimed");
  });

  it("has no checkbox, and shows when each Ticket was created", () => {
    view([row({ id: 208 })]);

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/Created .* · Modified/)).toBeTruthy();
  });

  it("shows Notes and Escalate in the drawer for the Claimer", async () => {
    view([row({ id: 207, claimedById: "me", claimedByName: "Me" })]);
    fireEvent.click(screen.getByRole("button", { name: "Open TKT-207" }));

    expect(screen.getByRole("button", { name: "Escalate" })).toBeTruthy();
    expect(await screen.findByText("Called the courier")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add internal note" })).toBeTruthy();
  });
});
