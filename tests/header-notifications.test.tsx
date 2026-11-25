// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeaderNotifications } from "@/components/layout/header-notifications";

const markAll = vi.fn();
const markOne = vi.fn();

function Bell({ feed }: { feed: React.ComponentProps<typeof HeaderNotifications>["feed"] }) {
  return <HeaderNotifications feed={feed} onMarkRead={markOne} onMarkAllRead={markAll} />;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const feed = {
  unread: 1,
  notifications: [
    { id: "2", kind: "new-customer" as const, ticketId: null, orderId: null, rating: null, returnId: null, customerId: "u-ben", customerName: "Ben Cruz", createdAt: new Date(), read: false },
    { id: "1", kind: "new-customer" as const, ticketId: null, orderId: null, rating: null, returnId: null, customerId: "u-ada", customerName: "Ada Lim", createdAt: new Date(Date.now() - 3 * 86_400_000), read: true },
  ],
};

describe("the header bell", () => {
  it("shows the unread count and no count when everything is read", () => {
    const { rerender } = render(<Bell feed={feed} />);
    expect(screen.getByLabelText("1 unread")).toBeTruthy();

    rerender(<Bell feed={{ ...feed, unread: 0 }} />);
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });

  it("lists each Customer with the date and time and a link to their profile", async () => {
    render(<Bell feed={feed} />);
    await userEvent.click(screen.getByTitle("Notifications"));

    const link = await screen.findByRole("link", { name: /Ben Cruz became a Customer/ });
    expect(link.getAttribute("href")).toBe("/customer-profiles/u-ben");
    const when = screen.getAllByText(/^\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} [AP]M$/);
    expect(when).toHaveLength(2);
    expect(when[0].tagName).toBe("TIME");
  });

  it("tells screen readers which rows are unread", async () => {
    render(<Bell feed={feed} />);
    await userEvent.click(screen.getByTitle("Notifications"));

    expect((await screen.findByRole("link", { name: /Ben Cruz/ })).textContent).toContain("Unread");
    expect(screen.getByRole("link", { name: /Ada Lim/ }).textContent).not.toContain("Unread");
  });

  it("marks one as read when its link is opened", async () => {
    render(<Bell feed={feed} />);
    await userEvent.click(screen.getByTitle("Notifications"));

    await userEvent.click(await screen.findByRole("link", { name: /Ben Cruz/ }));
    expect(markOne).toHaveBeenCalledWith("2");
  });

  it("does not mark a row that is already read", async () => {
    render(<Bell feed={feed} />);
    await userEvent.click(screen.getByTitle("Notifications"));

    await userEvent.click(await screen.findByRole("link", { name: /Ada Lim/ }));
    expect(markOne).not.toHaveBeenCalled();
  });

  it("marks all as read on request", async () => {
    render(<Bell feed={feed} />);
    await userEvent.click(screen.getByTitle("Notifications"));
    await userEvent.click(await screen.findByRole("button", { name: /Mark all read/ }));
    expect(markAll).toHaveBeenCalled();
  });

  it("says so when notifications cannot be read", async () => {
    render(<Bell feed={null} />);
    await userEvent.click(screen.getByTitle("Notifications"));

    expect(await screen.findByText("Notifications are temporarily unavailable.")).toBeTruthy();
  });

  it("words each Ticket alert and links it to its Ticket", async () => {
    const ticketFeed = {
      unread: 3,
      notifications: (["ticket-new", "ticket-message", "ticket-not-fixed"] as const).map((kind, i) => ({
        id: String(10 + i),
        kind,
        ticketId: 208,
        orderId: null,
        rating: null, returnId: null,
        customerId: "u-ada",
        customerName: "Ada Lim",
        createdAt: new Date(),
        read: false,
      })),
    };
    render(<Bell feed={ticketFeed} />);
    await userEvent.click(screen.getByTitle("Notifications"));

    for (const text of [/Ada Lim raised TKT-208/, /Ada Lim sent a message on TKT-208/, /Ada Lim says TKT-208 is not fixed/]) {
      expect((await screen.findByRole("link", { name: text })).getAttribute("href")).toBe("/tickets/208");
    }
  });

  it("words a low-rating Feedback alert and links it to that Feedback on the page", async () => {
    const lowFeed = {
      unread: 2,
      notifications: [
        { id: "21", kind: "feedback-low" as const, ticketId: null, orderId: 1042, rating: 1, returnId: null, customerId: "u-ada", customerName: "Ada Lim", createdAt: new Date(), read: false },
        { id: "20", kind: "feedback-low" as const, ticketId: null, orderId: 1040, rating: 3, returnId: null, customerId: "u-ben", customerName: "Ben Cruz", createdAt: new Date(), read: false },
      ],
    };
    render(<Bell feed={lowFeed} />);
    await userEvent.click(screen.getByTitle("Notifications"));

    const one = await screen.findByRole("link", { name: /Ada Lim rated Order #1042 1 star/ });
    expect(one.getAttribute("href")).toBe("/feedback#feedback-1042");
    const three = await screen.findByRole("link", { name: /Ben Cruz rated Order #1040 3 stars/ });
    expect(three.getAttribute("href")).toBe("/feedback#feedback-1040");
  });

  it("words a Requested Return alert and links it to that Return on the Returns page", async () => {
    const returnFeed = {
      unread: 1,
      notifications: [
        { id: "30", kind: "return-requested" as const, ticketId: null, orderId: 1042, rating: null, returnId: 7, customerId: "u-ada", customerName: "Ada Lim", createdAt: new Date(), read: false },
      ],
    };
    render(<Bell feed={returnFeed} />);
    await userEvent.click(screen.getByTitle("Notifications"));

    const link = await screen.findByRole("link", { name: /Ada Lim requested Return RMA-7/ });
    expect(link.getAttribute("href")).toBe("/returns#return-7");
  });

  it("shows nothing for Staff without the Returns Module, whose feed carries no Return alert", async () => {
    render(<Bell feed={{ unread: 0, notifications: [] }} />);
    await userEvent.click(screen.getByTitle("Notifications"));

    expect(await screen.findByText("No notifications yet.")).toBeTruthy();
    expect(screen.queryByText(/requested Return/)).toBeNull();
  });
});
