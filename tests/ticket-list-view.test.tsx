// @vitest-environment jsdom
import { someServiceLevel } from "./service-level-fixture";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TicketListView } from "@/features/tickets/ticket-list";
import type { TicketList, TicketRow } from "@/features/tickets/tickets";

vi.mock("@/features/tickets/actions", () => ({
  claim: vi.fn(),
  release: vi.fn(),
  reply: vi.fn(),
  resolve: vi.fn(),
}));
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
  lastActivity: new Date("2026-10-20T00:00:00Z"),
  serviceLevel: someServiceLevel(),
  ...overrides,
});

function view(rows: TicketRow[]) {
  const list: TicketList = {
    rows,
    counts: { open: 7, waiting: 3, on_hold: 2, resolved: 9, completed: 119, all: 135, mine: 4 },
    totalOpen: 7,
    overdue: 2,
    page: 1,
    pageSize: 25,
    totalPages: 1,
  };

  return render(<TicketListView list={list} params={{ tab: "open", page: 1 }} />);
}

describe("the Tickets list as designed", () => {
  it("has a Claim button on each Ticket", () => {
    view([row({ id: 208 }), row({ id: 207 })]);

    expect(screen.getAllByRole("button", { name: "Claim" })).toHaveLength(2);
  });

  it("shows who Claimed each Ticket, and offers Claim only on Unclaimed ones", () => {
    view([
      row({ id: 208 }),
      row({ id: 207, claimedById: "staff-2", claimedByName: "Rhea" }),
    ]);

    expect(screen.getByText("Rhea")).toBeTruthy();
    expect(screen.getByText("Unclaimed")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Claim" })).toHaveLength(1);
  });

  it("badges only the Tickets a Manager has been asked about", () => {
    view([row({ id: 208, escalated: true }), row({ id: 207 })]);

    expect(screen.getAllByText("Escalated")).toHaveLength(1);
  });

  it("shows each Ticket's Category", () => {
    view([row({ category: "Damaged item" })]);

    expect(screen.getByText("Damaged item")).toBeTruthy();
  });

  it("says nothing matched when a search or filter leaves no Tickets", () => {
    const list: TicketList = {
      rows: [],
      counts: { open: 0, waiting: 0, on_hold: 0, resolved: 0, completed: 0, all: 0, mine: 0 },
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
    const list = { rows: [row({})], counts: { open: 1, waiting: 0, on_hold: 0, resolved: 0, completed: 0, all: 1, mine: 0 }, totalOpen: 1, overdue: 0, page: 1, pageSize: 25, totalPages: 1 };

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
    for (const header of ["Ticket", "Subject", "Customer", "Linked order", "Category", "Priority", "Claimed by", "Status"]) {
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

    expect(screen.getByRole("link", { name: "TKT-208" }).getAttribute("href")).toBe("/tickets/208");
    expect(screen.getByText("None yet")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByText("Resolved")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
  });
});
