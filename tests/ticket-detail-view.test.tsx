// @vitest-environment jsdom
import { someServiceLevel } from "./service-level-fixture";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { claim, putOnHold, release, takeOffHold } from "@/features/tickets/actions";

import { TicketDetailView } from "@/features/tickets/ticket-detail";
import type { TicketDetail } from "@/features/tickets/ticket";

vi.mock("@/features/tickets/actions", () => ({
  claim: vi.fn(),
  release: vi.fn(),
  reply: vi.fn(),
  resolve: vi.fn(),
  putOnHold: vi.fn(),
  takeOffHold: vi.fn(),
  liveUrl: vi.fn(async () => null),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/** Every button except the Back navigation, which is not an action. */
const NAV = new Set(["Orders", "Returns", "Tickets"]);
const actionButtons = () => screen.queryAllByRole("button").filter((b) => !NAV.has(b.textContent ?? ""));


afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
  it("tags a Deleted Customer with no profile link", () => {
    render(<TicketDetailView ticket={ticket({ customer: { id: "c1", name: "Deleted customer", deleted: true, stage: "repeat", orders: 6, totalSpent: 473_400 } })} viewerId="bernice" />);

    expect(screen.getByTestId("deleted-customer-tag").textContent).toContain("Deleted customer");
    expect(screen.queryByRole("link", { name: "View customer profile →" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open order →" })).toBeNull();
  });

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
    render(<TicketDetailView ticket={ticket({ claimerId: null, claimerName: null })} viewerId="bernice" />);

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
    expect(screen.getByText("Attachment")).toBeTruthy();
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

  it("links the Linked order to the Order detail for Staff who can open it", () => {
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" canOpenOrder />);

    const card = screen.getByRole("region", { name: "Linked order" });

    expect(within(card).getByRole("link", { name: "Open order →" }).getAttribute("href")).toBe("/orders/1042");
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
  const buttons = () => actionButtons().map((b) => b.textContent);

  it("offers Release and Mark resolved to the Claimer, and not Claim", () => {
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" />);

    expect(buttons()).toEqual(["Release", "Escalate", "Put on hold", "Mark resolved"]);
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
    expect(actionButtons()).toEqual([]);
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

    expect(screen.getByText("Attachment")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  const withFile = (attachmentType: string, attachmentName: string) =>
    ticket({
      messages: [
        {
          id: 3, sender: "customer", senderName: "Maria", body: "", hasAttachment: true,
          attachmentUrl: "https://files.test/f2?signature=x", attachmentType, attachmentName,
          createdAt: new Date("2026-10-20T02:21:00Z"),
        },
      ],
    });

  it("plays a video from its short-lived address", () => {
    const { container } = render(<TicketDetailView ticket={withFile("video/mp4", "leak.mp4")} viewerId="bernice" />);

    const video = container.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("https://files.test/f2?signature=x");
    expect(video.hasAttribute("controls")).toBe(true);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("links a PDF by its file name", () => {
    render(<TicketDetailView ticket={withFile("application/pdf", "receipt.pdf")} viewerId="bernice" />);

    const link = screen.getByRole("link", { name: /receipt\.pdf/ });
    expect(link.getAttribute("href")).toBe("https://files.test/f2?signature=x");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows a video and a PDF in the chat bubbles too", () => {
    const messages = [
      { ...withFile("video/quicktime", "leak.mov").messages[0], id: 3 },
      { ...withFile("application/pdf", "receipt.pdf").messages[0], id: 4, sender: "staff" as const, senderName: "Bernice" },
    ];
    const { container } = render(<TicketDetailView ticket={ticket({ messages })} viewerId="bernice" />);

    expect(container.querySelector("video")).toBeTruthy();
    expect(screen.getByRole("link", { name: /receipt\.pdf/ })).toBeTruthy();
  });

  it("shows only the opening image, not a chat, until both sides have spoken", () => {
    render(<TicketDetailView ticket={withImage("https://files.test/f1?signature=x")} viewerId="bernice" />);

    expect(screen.queryByText(/Maria · /)).toBeNull();
    expect(screen.getByRole("img", { name: "Image attached by Maria" })).toBeTruthy();
  });
});

describe("Claim and Release show at once", () => {
  const unclaimed = ticket({ claimerId: null, claimerName: null });
  const view = (t = unclaimed) => render(<TicketDetailView ticket={t} viewerId="carlo" viewerName="Carlo" />);

  it("makes the Staff member the Claimer before the server answers, and keeps it once confirmed", async () => {
    let confirm: (r: { ok: true }) => void = () => {};
    vi.mocked(claim).mockReturnValueOnce(new Promise((resolve) => (confirm = resolve)));
    view();

    await userEvent.click(screen.getByRole("button", { name: "Claim" }));

    expect(screen.getByText(/Claimed by Carlo/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Release" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Claim" })).toBeNull();

    confirm({ ok: true });
    await vi.waitFor(() =>
      expect((screen.getByRole("button", { name: "Release" }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(claim).toHaveBeenCalledWith(208, expect.any(String));
    expect(screen.getByText(/Claimed by Carlo/)).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("rolls back and says so when the action never reaches the server", async () => {
    vi.mocked(claim).mockRejectedValueOnce(new Error("offline"));
    view();

    await userEvent.click(screen.getByRole("button", { name: "Claim" }));

    await screen.findByText(/Unclaimed/);
    expect(toast.error).toHaveBeenCalledWith("CREOMS could not save that. Try again in a moment.");
  });

  it("holds the buttons while the claim is pending, so it cannot be sent twice", async () => {
    vi.mocked(claim).mockReturnValueOnce(new Promise(() => {}));
    view();

    await userEvent.click(screen.getByRole("button", { name: "Claim" }));

    expect((screen.getByRole("button", { name: "Release" }) as HTMLButtonElement).disabled).toBe(true);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("rolls back a refused claim and says who holds the Ticket", async () => {
    vi.mocked(claim).mockResolvedValueOnce({ ok: false, reason: "claimed", claimerName: "Bernice" });
    view();

    await userEvent.click(screen.getByRole("button", { name: "Claim" }));

    await screen.findByText(/Unclaimed/);
    expect(screen.getByRole("button", { name: "Claim" })).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith("Bernice has already claimed this Ticket.");
  });

  it("returns the Ticket to Unclaimed at once on Release, and rolls back a refused Release", async () => {
    vi.mocked(release).mockReturnValueOnce(new Promise(() => {}));
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" viewerName="Bernice" />);

    await userEvent.click(screen.getByRole("button", { name: "Release" }));

    expect(screen.getByText(/Unclaimed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Claim" })).toBeTruthy();
    cleanup();

    vi.mocked(release).mockResolvedValueOnce({ ok: false, reason: "not-claimer" });
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" viewerName="Bernice" />);
    await userEvent.click(screen.getByRole("button", { name: "Release" }));

    await screen.findByText(/Claimed by Bernice/);
    expect(toast.error).toHaveBeenCalledWith("Only the Staff member who claimed a Ticket can release it.");
  });
});

describe("On hold", () => {
  const held = {
    status: "on_hold" as const,
    hold: { reason: "courier" as const, note: "Lalamove is down", until: new Date("2026-10-21T10:00:00Z") },
  };
  const view = (t = ticket(), viewer = "bernice") => render(<TicketDetailView ticket={t} viewerId={viewer} viewerName="Bernice" />);

  async function fillAndConfirm() {
    await userEvent.click(screen.getByRole("button", { name: "Put on hold" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: /Supplier/ }));
    await userEvent.type(within(dialog).getByLabelText(/Note/), "Waiting on boxes");
    fireEvent.change(within(dialog).getByLabelText(/Back to Open on/), { target: { value: "2099-01-01T10:00" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Put on hold" }));
  }

  it("offers Put on hold only to the Claimer of an Open Ticket", () => {
    view();
    expect(screen.getByRole("button", { name: "Put on hold" })).toBeTruthy();
    cleanup();
    view(ticket(), "carlo");
    expect(screen.queryByRole("button", { name: "Put on hold" })).toBeNull();
    cleanup();
    view(ticket(held));
    expect(screen.queryByRole("button", { name: "Put on hold" })).toBeNull();
    expect(screen.getByRole("button", { name: "Take off hold" })).toBeTruthy();
  });

  it("asks first, and requires a date and time before it sends anything", async () => {
    view();
    await userEvent.click(screen.getByRole("button", { name: "Put on hold" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Put TKT-208 on hold?")).toBeTruthy();

    await userEvent.click(within(dialog).getByRole("button", { name: "Put on hold" }));

    expect(within(dialog).getByRole("alert").textContent).toMatch(/when the Ticket returns to Open/);
    expect(putOnHold).not.toHaveBeenCalled();
  });

  it("shows On hold and the reason at once, and keeps it once confirmed", async () => {
    let confirm: (r: { ok: true }) => void = () => {};
    vi.mocked(putOnHold).mockReturnValueOnce(new Promise((resolve) => (confirm = resolve)));
    view();

    await fillAndConfirm();

    expect(screen.getByText("On hold")).toBeTruthy();
    expect(screen.getByText(/waiting on Supplier/)).toBeTruthy();
    expect(screen.getByText(/Note \(Staff only\): Waiting on boxes/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take off hold" })).toBeTruthy();
    expect(putOnHold).toHaveBeenCalledWith(208, expect.objectContaining({ reason: "supplier", note: "Waiting on boxes" }), expect.any(String));

    confirm({ ok: true });
    await vi.waitFor(() => expect(toast.error).not.toHaveBeenCalled());
    expect(screen.getByText("On hold")).toBeTruthy();
  });

  it("rolls back and says why when the server refuses", async () => {
    vi.mocked(putOnHold).mockResolvedValueOnce({ ok: false, reason: "not-claimed" });
    view();

    await fillAndConfirm();

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("This Ticket is no longer claimed by you."));
    expect(screen.queryByText(/waiting on Supplier/)).toBeNull();
    expect(screen.getByRole("button", { name: "Put on hold" })).toBeTruthy();
  });

  it("shows any Staff the reason, the return time and the note, and tells them the Customer does not see it", () => {
    view(ticket(held), "carlo");

    const panel = screen.getByRole("region", { name: "On hold" });
    expect(within(panel).getByText(/waiting on Courier \(Lalamove or Grab\)/)).toBeTruthy();
    expect(within(panel).getByText(/Note \(Staff only\): Lalamove is down/)).toBeTruthy();
    expect(within(panel).getByText(/not the reason/)).toBeTruthy();
  });

  it("takes it off hold at once, and rolls back with the reason on a refusal", async () => {
    vi.mocked(takeOffHold).mockResolvedValueOnce({ ok: false, reason: "not-on-hold" });
    view(ticket(held));

    await userEvent.click(screen.getByRole("button", { name: "Take off hold" }));
    expect(takeOffHold).toHaveBeenCalledWith(208, expect.any(String));

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("This Ticket is no longer on hold."));
    expect(screen.getByRole("region", { name: "On hold" })).toBeTruthy();
  });
});

describe("Customer rating and Related tickets", () => {
  it("shows the rating and comment, and no rating section when there is none", () => {
    render(<TicketDetailView ticket={ticket({ rating: { stars: 4, comment: "Quick help", at: new Date("2026-10-20T03:00:00Z") } })} viewerId="bernice" />);
    const section = screen.getByRole("region", { name: "Customer rating" });
    expect(within(section).getByText("4 out of 5")).toBeTruthy();
    expect(within(section).getByText(/Quick help/)).toBeTruthy();
    cleanup();
    render(<TicketDetailView ticket={ticket()} viewerId="bernice" />);
    expect(screen.queryByRole("region", { name: "Customer rating" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Related tickets" })).toBeNull();
  });

  it("links Follow-up of TKT-x and Follow-up: TKT-y", () => {
    render(
      <TicketDetailView
        ticket={ticket({
          followUpOf: { id: 100, subject: "Leaking pouch", status: "completed" },
          followUps: [{ id: 300, subject: "Still no refund", status: "open" }],
        })}
        viewerId="bernice"
      />,
    );
    const section = screen.getByRole("region", { name: "Related tickets" });
    expect(within(section).getByText(/Follow-up of/)).toBeTruthy();
    expect(within(section).getByRole("link", { name: "TKT-100" }).getAttribute("href")).toBe("/tickets/100");
    expect(within(section).getByText(/Follow-up:/)).toBeTruthy();
    expect(within(section).getByRole("link", { name: "TKT-300" }).getAttribute("href")).toBe("/tickets/300");
  });
});
