// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Conversations } from "@/features/tickets/conversations";
import { ConversationsView } from "@/features/tickets/conversations-view";
import type { TicketDetail } from "@/features/tickets/ticket";

vi.mock("@/features/tickets/actions", () => ({
  claim: vi.fn(),
  release: vi.fn(),
  reply: vi.fn(),
  resolve: vi.fn(),
  liveUrl: vi.fn(async () => null),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

const NOW = new Date("2026-10-20T12:00:00Z");

const ticket = (overrides: Partial<TicketDetail> = {}): TicketDetail => ({
  id: 208,
  subject: "Halaya pouch arrived leaking",
  status: "open",
  priority: "high",
  openedAt: new Date("2026-10-19T02:00:00Z"),
  claimerName: "Bernice",
  claimerId: "bernice",
  messages: [
    {
      id: 1,
      sender: "customer",
      senderName: "Maria",
      body: "One of the halaya pouches was leaking.",
      hasAttachment: false,
      createdAt: new Date("2026-10-19T02:12:00Z"),
    },
  ],
  order: { id: 1042, total: 100_700, status: "dispatched", lines: [{ product: "Smooth tub", quantity: 2 }] },
  customer: { id: "c1", name: "Maria Santos", stage: "repeat", orders: 6, totalSpent: 473_400 },
  ...overrides,
});

function view(selected: TicketDetail | null = ticket(), viewerId = "bernice") {
  const conversations: Conversations = {
    chats: [
      { ticketId: 208, customerName: "Maria Santos", preview: "Replacement please", lastActivity: new Date(NOW.getTime() - 5 * 60_000) },
      { ticketId: 206, customerName: "Ana Reyes", preview: "My receipt was rejected", lastActivity: new Date(NOW.getTime() - 3 * 3_600_000) },
    ],
    selected,
  };

  return render(<ConversationsView conversations={conversations} viewerId={viewerId} viewerName="Bernice" now={NOW} />);
}

describe("the Conversations page as designed", () => {
  it("lists each chat with Customer name, preview, time and Ticket number, linking to it", () => {
    view();

    const list = screen.getByRole("navigation", { name: "Chats" });
    const ana = within(list).getByRole("link", { name: /Ana Reyes/ });

    expect(ana.textContent).toBe("Ana Reyes3hMy receipt was rejectedTKT-206");
    expect(ana.getAttribute("href")).toBe("/conversations?ticket=206");
    expect(within(list).getByRole("link", { name: /Maria Santos/ }).textContent).toContain("5m");
    expect(within(list).getByRole("link", { name: /Maria Santos/ }).getAttribute("aria-current")).toBe("true");
  });

  it("drops the Compose button, Not matched label and Turn this into card", () => {
    view();

    for (const gone of ["Compose", "Not matched", "Turn this into…", "Convert to ticket", "Messenger"]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it("shows the open chat's Messages and a reply box", () => {
    view();

    const chat = screen.getByRole("region", { name: "Chat" });

    expect(within(chat).getByText("One of the halaya pouches was leaking.")).toBeTruthy();
    expect(within(chat).getByRole("textbox", { name: "Write a reply" })).toBeTruthy();
  });

  it("shows the Customer card with Stage, orders, Total spent and the Customer Profile link", () => {
    view();

    const card = screen.getByRole("region", { name: "Customer" });

    expect(within(card).getByText("Repeat")).toBeTruthy();
    expect(within(card).getByText("6 orders · ₱4,734 total spent")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "View customer profile →" }).getAttribute("href")).toBe("/customer-profiles/c1");
  });

  it("shows the Ticket card with number, subject, status, Priority, Claimer, Linked order and a link to the Ticket", () => {
    view();

    const card = screen.getByRole("region", { name: "Ticket" });

    expect(within(card).getByRole("heading", { name: "TKT-208" })).toBeTruthy();
    expect(within(card).getByText("Halaya pouch arrived leaking")).toBeTruthy();
    expect(within(card).getByText("Open")).toBeTruthy();
    expect(within(card).getByText("High")).toBeTruthy();
    expect(within(card).getByText("Bernice")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "#1042" }).getAttribute("href")).toBe("/customer-profiles/c1#order-1042");
    expect(within(card).getByRole("link", { name: "Open ticket →" }).getAttribute("href")).toBe("/tickets/208");
  });

  it("says None yet without a Linked order, and Unclaimed without a Claimer", () => {
    view(ticket({ order: null, claimerId: null, claimerName: null }), "carlo");

    const card = screen.getByRole("region", { name: "Ticket" });

    expect(within(card).getByText("None yet")).toBeTruthy();
    expect(within(card).getByText("Unclaimed")).toBeTruthy();
  });

  it("offers Release and Mark resolved to the Claimer, Claim on an Unclaimed Ticket, and no Reply link", () => {
    view();
    const card = () => within(screen.getByRole("region", { name: "Ticket" }));

    expect(card().getByRole("button", { name: "Release" })).toBeTruthy();
    expect(card().getByRole("button", { name: "Mark resolved" })).toBeTruthy();
    expect(card().queryByRole("button", { name: "Claim" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Reply" })).toBeNull();
    cleanup();

    view(ticket({ claimerId: null, claimerName: null }), "carlo");
    expect(card().getByRole("button", { name: "Claim" })).toBeTruthy();
  });

  it("gives another Staff member no reply box on a Claimed Ticket", () => {
    view(ticket(), "carlo");

    expect(screen.queryByRole("textbox", { name: "Write a reply" })).toBeNull();
    expect(screen.getByText("Bernice claimed this Ticket, so only they can reply.")).toBeTruthy();
  });

  it("says so when there are no chats", () => {
    render(<ConversationsView conversations={{ chats: [], selected: null }} viewerId="bernice" viewerName="Bernice" />);

    expect(screen.getByText("No chats yet.")).toBeTruthy();
  });
});
