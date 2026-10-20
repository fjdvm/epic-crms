// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeaderNotifications } from "@/components/layout/header-notifications";

const { markAll, markOne } = vi.hoisted(() => ({ markAll: vi.fn(), markOne: vi.fn() }));
vi.mock("@/features/notifications/actions", () => ({
  markAllNotificationsRead: markAll,
  markNotificationRead: markOne,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const feed = {
  unread: 1,
  notifications: [
    { id: "2", kind: "new-customer" as const, ticketId: null, customerId: "u-ben", customerName: "Ben Cruz", createdAt: new Date(), read: false },
    { id: "1", kind: "new-customer" as const, ticketId: null, customerId: "u-ada", customerName: "Ada Lim", createdAt: new Date(Date.now() - 3 * 86_400_000), read: true },
  ],
};

describe("the header bell", () => {
  it("shows the unread count and no count when everything is read", () => {
    const { rerender } = render(<HeaderNotifications feed={feed} />);
    expect(screen.getByLabelText("1 unread")).toBeTruthy();

    rerender(<HeaderNotifications feed={{ ...feed, unread: 0 }} />);
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });

  it("lists each Customer with how long ago and a link to their profile", async () => {
    render(<HeaderNotifications feed={feed} />);
    await userEvent.click(screen.getByTitle("Notifications"));

    const link = await screen.findByRole("link", { name: /Ben Cruz became a Customer/ });
    expect(link.getAttribute("href")).toBe("/customer-profiles/u-ben");
    expect(screen.getByText("3 days ago")).toBeTruthy();
  });

  it("marks one as read when its link is opened", async () => {
    render(<HeaderNotifications feed={feed} />);
    await userEvent.click(screen.getByTitle("Notifications"));

    await userEvent.click(await screen.findByRole("link", { name: /Ben Cruz/ }));
    expect(markOne).toHaveBeenCalledWith("2");
  });

  it("marks all as read on request", async () => {
    render(<HeaderNotifications feed={feed} />);
    await userEvent.click(screen.getByTitle("Notifications"));
    await userEvent.click(await screen.findByRole("button", { name: /Mark all read/ }));
    expect(markAll).toHaveBeenCalled();
  });

  it("says so when notifications cannot be read", async () => {
    render(<HeaderNotifications feed={null} />);
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
        customerId: "u-ada",
        customerName: "Ada Lim",
        createdAt: new Date(),
        read: false,
      })),
    };
    render(<HeaderNotifications feed={ticketFeed} />);
    await userEvent.click(screen.getByTitle("Notifications"));

    for (const text of [/Ada Lim raised TKT-208/, /Ada Lim sent a message on TKT-208/, /Ada Lim says TKT-208 is not fixed/]) {
      expect((await screen.findByRole("link", { name: text })).getAttribute("href")).toBe("/tickets/208");
    }
  });
});
