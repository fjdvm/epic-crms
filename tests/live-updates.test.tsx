// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LiveUpdatesProvider,
  useLiveFeed,
  useNewCustomerIds,
} from "@/features/notifications/live-updates";
import type { Notification, NotificationFeed } from "@/features/notifications/notifications";

const { toast, refresh } = vi.hoisted(() => ({ toast: { info: vi.fn() }, refresh: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function note(id: string, name: string): Notification {
  return { id, kind: "new-customer" as const, ticketId: null, orderId: null, rating: null, returnId: null, customerId: `u-${id}`, customerName: name, createdAt: new Date(), read: false };
}

const ada = note("1", "Ada Lim");
const ben = note("2", "Ben Cruz");

function feedOf(...notifications: Notification[]): NotificationFeed {
  return { unread: notifications.length, notifications };
}

function Probe() {
  const feed = useLiveFeed();
  const fresh = useNewCustomerIds();

  return (
    <p>
      unread:{feed?.unread ?? "none"} new:{[...fresh].join(",")}
    </p>
  );
}

function mount(poll: () => Promise<NotificationFeed | null>, enabled = true) {
  return render(
    <LiveUpdatesProvider initialFeed={feedOf(ada)} poll={poll} enabled={enabled}>
      <Probe />
    </LiveUpdatesProvider>,
  );
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("live updates", () => {
  it("polls about every 5 seconds while the tab is visible", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    mount(poll);

    await elapse(4_900);
    expect(poll).not.toHaveBeenCalled();
    await elapse(200);
    expect(poll).toHaveBeenCalledTimes(1);
    await elapse(5_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("does not poll while the tab is hidden, and catches up when it is shown again", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    mount(poll);

    setVisibility("hidden");
    await elapse(30_000);
    expect(poll).not.toHaveBeenCalled();

    setVisibility("visible");
    await elapse(0);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("does not poll when the Staff member has no Customer Profiles Module", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    mount(poll, false);

    await elapse(30_000);
    expect(poll).not.toHaveBeenCalled();
  });

  it("toasts once per new notification, updates the bell, highlights the Customer and refreshes the list", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ben, ada));
    mount(poll);

    await elapse(5_000);

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("Ben Cruz became a Customer");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("unread:2 new:u-2")).toBeTruthy();

    await elapse(5_000);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("toasts a Ticket alert once without marking any Customer as New", async () => {
    const alert: Notification = { ...note("3", "Cy Tan"), kind: "ticket-message", ticketId: 208 };
    mount(vi.fn().mockResolvedValue(feedOf(alert, ada)));

    await elapse(5_000);
    await elapse(5_000);

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("Cy Tan sent a message on TKT-208");
    expect(screen.getByText("unread:2 new:")).toBeTruthy();
  });

  it("drops the New highlight after a while", async () => {
    mount(vi.fn().mockResolvedValue(feedOf(ben, ada)));

    await elapse(5_000);
    expect(screen.getByText("unread:2 new:u-2")).toBeTruthy();

    await elapse(15_000);
    expect(screen.getByText("unread:2 new:")).toBeTruthy();
  });

  it("keeps the last feed when a poll cannot be answered", async () => {
    const poll = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount(poll);

    await elapse(10_000);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(screen.getByText("unread:1 new:")).toBeTruthy();
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("the list row", () => {
  it("shows New only for Customers who just arrived", async () => {
    const { LiveRow } = await import("@/features/customer-profiles/live-row");
    render(
      <LiveUpdatesProvider initialFeed={feedOf(ada)} poll={vi.fn().mockResolvedValue(feedOf(ben, ada))} enabled>
        <LiveRow customerId="u-2" className="row">Ben</LiveRow>
        <LiveRow customerId="u-1" className="row">Ada</LiveRow>
      </LiveUpdatesProvider>,
    );
    await elapse(5_000);

    expect(screen.getByText("Ben").getAttribute("data-new")).toBe("true");
    expect(screen.getByText("Ada").getAttribute("data-new")).toBeNull();
    expect(screen.getAllByText("New")).toHaveLength(1);
  });
});
