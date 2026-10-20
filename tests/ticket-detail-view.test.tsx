// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TicketDetailView } from "@/features/tickets/ticket-detail";
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
    {
      id: 2,
      sender: "staff",
      senderName: "Bernice",
      body: "So sorry about that, Maria!",
      hasAttachment: false,
      createdAt: new Date("2026-10-19T02:15:00Z"),
    },
    {
      id: 3,
      sender: "customer",
      senderName: "Maria",
      body: "Here it is.",
      hasAttachment: true,
      createdAt: new Date("2026-10-20T02:21:00Z"),
    },
  ],
  order: {
    id: 1042,
    total: 100_700,
    status: "dispatched",
    lines: [
      { product: "Smooth tub", quantity: 2 },
      { product: "Powder", quantity: 1 },
    ],
  },
  customer: {
    id: "c1",
    name: "Maria Santos",
    stage: "repeat",
    orders: 6,
    totalSpent: 473_400,
  },
  ...overrides,
});

describe("the Ticket page as designed", () => {
  it("has the TKT number, subject and status in the title, and the opened date, Claimer and Priority beneath", () => {
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" />);

    expect(
      screen.getByRole("heading", {
        name: /TKT-208 · Halaya pouch arrived leaking/,
      }),
    ).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Opened 19 Oct 2026 · Claimed by Bernice · High priority")).toBeTruthy();
  });

  it("says Unclaimed when nobody has Claimed the Ticket", () => {
    render(<TicketDetailView ticket={ticket({ claimerName: null })} viewerId="bernice" />);

    expect(screen.getByText(/· Unclaimed ·/)).toBeTruthy();
  });

  it("shows every Message in order with sender and time", () => {
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" />);

    const conversation = screen.getByRole("region", { name: "Conversation" });
    const bodies = within(conversation).getAllByText(/leaking|So sorry|Here it is/);

    expect(bodies.map((b) => b.textContent)).toEqual([
      "One of the halaya pouches was leaking.",
      "So sorry about that, Maria!",
      "Here it is.",
    ]);
    expect(within(conversation).getByText("Maria · 10:12 AM")).toBeTruthy();
    expect(within(conversation).getByText("Bernice · 10:15 AM")).toBeTruthy();
  });

  it("adds the date to a Message sent on a later day, and notes an attached photo", () => {
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" />);

    expect(screen.getByText("Maria · 20 Oct 2026, 10:21 AM")).toBeTruthy();
    expect(screen.getByText("Photo attached")).toBeTruthy();
  });

  it("has no Resolve with card, since replacement, refund and return actions are out of v1", () => {
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" />);

    expect(screen.queryByText("Resolve with")).toBeNull();
  });

  it("shows the Linked order card with its link to the Order", () => {
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" />);

    const card = screen.getByRole("region", { name: "Linked order" });

    expect(within(card).getByText("#1042 · ₱1,007")).toBeTruthy();
    expect(within(card).getByText("Paid")).toBeTruthy();
    expect(within(card).getByText("Dispatched")).toBeTruthy();
    expect(within(card).getByText("Smooth tub ×2, Powder ×1")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Open order →" }).getAttribute("href")).toBe(
      "/customer-profiles/c1#order-1042",
    );
  });

  it("hides the Linked order card when the Ticket has no Order", () => {
    render(<TicketDetailView ticket={ticket({ order: null })} viewerId="bernice" />);

    expect(screen.queryByRole("region", { name: "Linked order" })).toBeNull();
  });

  it("shows the Customer card with Stage, order count, Total spent and a link to the Customer Profile", () => {
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" />);

    const card = screen.getByRole("region", { name: "Customer" });

    expect(within(card).getByText("Repeat")).toBeTruthy();
    expect(within(card).getByText("Maria Santos · 6 orders · ₱4,734")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "View customer profile →" }).getAttribute("href")).toBe(
      "/customer-profiles/c1",
    );
  });

  it("says order, not orders, for a single Order", () => {
    render(
      <TicketDetailView
        ticket={ticket({
          customer: {
            id: "c1",
            name: "Maria Santos",
            stage: "first-order",
            orders: 1,
            totalSpent: 0,
          },
        })}
        viewerId="bernice"
      />,
    );

    expect(screen.getByText("Maria Santos · 1 order · ₱0")).toBeTruthy();
  });
});

describe("working the Ticket", () => {
  const buttons = () => screen.getAllByRole("button").map((b) => b.textContent);

  it("offers Release and Mark resolved to the Claimer, and not Claim", () => {
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" />);

    expect(buttons()).toEqual(["Release", "Mark resolved"]);
  });

  it("offers Claim on an Unclaimed Ticket, and no Release", () => {
    render(<TicketDetailView ticket={ticket({ claimerId: null, claimerName: null })} viewerId="carlo" />);

    expect(buttons()).toContain("Claim");
    expect(buttons()).not.toContain("Release");
  });

  it("gives another Staff member no Claim or Release on a Claimed Ticket", () => {
    render(<TicketDetailView ticket={ticket()} viewerId="carlo" />);

    expect(buttons()).not.toContain("Claim");
    expect(buttons()).not.toContain("Release");
  });

  it("offers no Mark resolved once Resolved, and no buttons at all once Completed", () => {
    render(<TicketDetailView ticket={ticket({ status: "resolved" })} viewerId="bernice" />);
    expect(buttons()).not.toContain("Mark resolved");
    cleanup();

    render(<TicketDetailView ticket={ticket({ status: "completed" })} viewerId="bernice" />);
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

describe("chatting from the Ticket page", () => {
  it("has no reply box; a Chat button opens this Ticket's chat in Conversations", () => {
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" />);

    expect(screen.queryByRole("textbox", { name: "Write a reply" })).toBeNull();
    expect(screen.getByRole("link", { name: "Chat" }).getAttribute("href")).toBe("/conversations?ticket=208");
  });

  it("offers no Chat once the Ticket is Completed", () => {
    render(<TicketDetailView ticket={ticket({ status: "completed" })} viewerId="bernice" />);

    expect(screen.queryByRole("link", { name: "Chat" })).toBeNull();
  });
});

describe("images on Messages", () => {
  const withImage = (attachmentUrl: string | null) =>
    ticket({
      messages: [
        {
          id: 3,
          sender: "customer",
          senderName: "Maria",
          body: "",
          hasAttachment: true,
          attachmentUrl,
          createdAt: new Date("2026-10-20T02:21:00Z"),
        },
      ],
    });

  it("shows the image from its short-lived address, even without text", () => {
    render(<TicketDetailView ticket={withImage("https://files.test/f1?signature=x")} viewerId="bernice" />);

    expect(screen.getByRole("img", { name: "Image attached by Maria" }).getAttribute("src")).toBe(
      "https://files.test/f1?signature=x",
    );
  });

  it("still says a photo is attached when the image cannot be shown here", () => {
    render(<TicketDetailView ticket={withImage(null)} viewerId="bernice" />);

    expect(screen.getByText("Photo attached")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows only the opening image, not a chat, until both sides have spoken", () => {
    render(<TicketDetailView ticket={withImage("https://files.test/f1?signature=x")} viewerId="bernice" />);

    expect(screen.queryByText(/Maria · /)).toBeNull();
    expect(screen.getByRole("img", { name: "Image attached by Maria" })).toBeTruthy();
  });
});
