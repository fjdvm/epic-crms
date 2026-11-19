// @vitest-environment jsdom
import { someServiceLevel } from "./service-level-fixture";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  category: "Order Issue",
  priority: "high",
  openedAt: new Date("2026-10-19T02:00:00Z"),
  claimerName: "Bernice",
  claimerId: "bernice",
  hold: null,
  serviceLevel: someServiceLevel(),
  rating: null,
  followUpOf: null,
  followUps: [],
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

function view(selected: TicketDetail | null = ticket(), viewerId = "bernice", canDraft = false) {
  const conversations: Conversations = {
    chats: [
      { ticketId: 208, customerName: "Maria Santos", preview: "Replacement please", lastActivity: new Date(NOW.getTime() - 5 * 60_000) },
      { ticketId: 206, customerName: "Ana Reyes", preview: "My receipt was rejected", lastActivity: new Date(NOW.getTime() - 3 * 3_600_000) },
    ],
    selected,
  };

  return render(<ConversationsView conversations={conversations} viewerId={viewerId} viewerName="Bernice" now={NOW} canDraft={canDraft} />);
}

describe("the Conversations page as designed", () => {
  it("lists each chat with Customer name, preview, time and Ticket number, linking to it", () => {
    view();

    const list = screen.getByRole("navigation", { name: "Chats" });
    const ana = within(list).getByRole("link", { name: /Ana Reyes/ });

    expect(ana.textContent).toBe("ARAna Reyes TKT-2063hMy receipt was rejected");
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

  it("shows the chat header with name, Ticket number, who claimed it, the order and a link to the Ticket", () => {
    view();

    const chat = screen.getByRole("region", { name: "Chat" });

    expect(within(chat).getByRole("heading", { name: "Maria Santos · TKT-208" })).toBeTruthy();
    expect(within(chat).getByText("Claimed by you · BR-1042")).toBeTruthy();
    expect(within(chat).getByRole("link", { name: "Open ticket" }).getAttribute("href")).toBe("/tickets/208");
  });

  it("says Unclaimed in the header without a Claimer, and offers Claim", () => {
    view(ticket({ order: null, claimerId: null, claimerName: null }), "carlo");
    const chat = screen.getByRole("region", { name: "Chat" });

    expect(within(chat).getByText("Unclaimed")).toBeTruthy();
    expect(within(chat).getByRole("button", { name: "Claim" })).toBeTruthy();
  });

  it("offers Mine, Unclaimed and All tabs that keep the open chat's search", () => {
    render(
      <ConversationsView
        conversations={{ chats: [], selected: null }}
        viewerId="bernice"
        viewerName="Bernice"
        query="maria"
        scope="unclaimed"
        scopes={["mine", "unclaimed", "all"]}
      />,
    );
    const tabs = screen.getByRole("tablist", { name: "Inbox" });

    expect(within(tabs).getByRole("tab", { name: "Unclaimed" }).getAttribute("aria-selected")).toBe("true");
    expect(within(tabs).getByRole("tab", { name: "All" }).getAttribute("href")).toBe("/conversations?tab=all&q=maria");
    expect(within(tabs).getByRole("tab", { name: "Mine" }).getAttribute("href")).toBe("/conversations?q=maria");
  });

  it("switches the reply box to an Internal note with the Internal note tab", () => {
    view();

    fireEvent.click(screen.getByRole("tab", { name: "Internal note" }));

    expect(screen.queryByRole("textbox", { name: "Write a reply" })).toBeNull();
    expect(screen.getByPlaceholderText("Write a note for your teammates…")).toBeTruthy();
  });

  it("opens an image full screen, steps through the chat's images and closes it", () => {
    const image = (id: number, url: string) => ({
      id,
      sender: "customer" as const,
      senderName: "Maria",
      body: id === 1 ? "Here are photos" : "",
      hasAttachment: true,
      attachmentUrl: url,
      attachmentType: "image/jpeg",
      attachmentName: `IMG_${id}.jpg`,
      attachmentSize: 1_200_000,
      createdAt: new Date("2026-10-19T02:12:00Z"),
    });
    view(ticket({ messages: [image(1, "https://f/1.jpg"), image(2, "https://f/2.jpg")] }));

    fireEvent.click(screen.getAllByRole("button", { name: "Open image from Maria" })[1]);
    const viewer = screen.getByRole("dialog", { name: "Photo from Maria" });

    expect(within(viewer).getByText("2 of 2 in chat")).toBeTruthy();
    expect(within(viewer).getByText(/IMG_2\.jpg · 1\.2 MB/)).toBeTruthy();
    expect(within(viewer).getByText("100%")).toBeTruthy();
    fireEvent.click(within(viewer).getByRole("button", { name: "Zoom in" }));
    expect(within(viewer).getByText("150%")).toBeTruthy();
    fireEvent.click(within(viewer).getByRole("button", { name: "Previous image" }));
    expect(within(viewer).getByText("1 of 2 in chat")).toBeTruthy();
    expect(within(viewer).getByText("Here are photos")).toBeTruthy();
    fireEvent.click(within(viewer).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
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

describe("the read-only chat for Admin and CEO", () => {
  it("shows the Messages but no reply box, notes, claim buttons or draft panel", () => {
    render(
      <ConversationsView
        conversations={{ chats: [], selected: ticket() }}
        viewerId="admin"
        viewerName="Admin"
        readOnly
      />,
    );
    const chat = screen.getByRole("region", { name: "Chat" });

    expect(within(chat).getByText("One of the halaya pouches was leaking.")).toBeTruthy();
    expect(within(chat).getByText(/Read-only · Admin and CEO & VP can read chats but never reply or run AI/)).toBeTruthy();
    expect(within(chat).getByRole("link", { name: "Open ticket" })).toBeTruthy();
    expect(within(chat).queryByRole("textbox")).toBeNull();
    expect(within(chat).queryByRole("tab", { name: "Internal note" })).toBeNull();
    expect(within(chat).queryByRole("button", { name: "Claim" })).toBeNull();
    expect(within(chat).queryByRole("button", { name: "Release" })).toBeNull();
  });
});

describe("the draft panel on the chat", () => {
  it("shows the panel to Staff and Managers, and none to Admin or CEO", () => {
    const staff = view(ticket(), "bernice", true);
    expect(screen.queryByRole("region", { name: "Draft reply" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "AI suggestion" }));
    expect(screen.getByRole("region", { name: "Draft reply" })).toBeTruthy();
    staff.unmount();
    view(ticket(), "bernice", false);
    expect(screen.queryByRole("region", { name: "Draft reply" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "AI suggestion" })).toBeNull();
  });
});
