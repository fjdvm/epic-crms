// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TicketListView } from "@/features/tickets/ticket-list";
import type { TicketList, TicketRow } from "@/features/tickets/tickets";

afterEach(cleanup);

const row = (overrides: Partial<TicketRow>): TicketRow => ({
  id: 208,
  subject: "Halaya pouch arrived leaking",
  customerName: "Maria Santos",
  orderId: 1042,
  priority: "high",
  status: "open",
  waiting: false,
  overdue: false,
  lastActivity: new Date("2026-10-20T00:00:00Z"),
  ...overrides,
});

function view(rows: TicketRow[]) {
  const list: TicketList = {
    rows,
    counts: { open: 7, waiting: 3, resolved: 128 },
    overdue: 2,
    page: 1,
    pageSize: 25,
    totalPages: 1,
  };

  return render(<TicketListView list={list} params={{ tab: "open", page: 1 }} />);
}

describe("the Tickets list as designed", () => {
  it("has the three tabs with their counts and no Channel column", () => {
    view([row({})]);

    expect(screen.getByRole("link", { name: "Open 7" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Waiting on customer 3" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Resolved 128" })).toBeTruthy();
    expect(screen.queryByText("Channel")).toBeNull();
    for (const header of ["Ticket", "Subject", "Customer", "Linked order", "Priority", "Status"]) {
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

    expect(screen.getByRole("link", { name: "TKT-208" }).getAttribute("href")).toBe("/conversations?ticket=208");
    expect(screen.getByText("None yet")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getAllByText("Resolved")).toHaveLength(2);
    expect(screen.getByText("Overdue")).toBeTruthy();
  });
});
