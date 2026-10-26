// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LiveUpdatesProvider,
  useFeedActions,
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

function mount(
  poll: () => Promise<NotificationFeed | null>,
  enabled = true,
  extra: Partial<React.ComponentProps<typeof LiveUpdatesProvider>> = {},
) {
  return render(
    <LiveUpdatesProvider initialFeed={feedOf(ada)} poll={poll} enabled={enabled} {...extra}>
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

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  readyState = 1;
  static OPEN = 1;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.();
  }
  open() {
    this.onopen?.();
  }
  nudge() {
    this.onmessage?.({ data: JSON.stringify({ type: "notification.created" }) });
  }
}

const liveUrl = () => Promise.resolve("wss://gateway/notifications/live?ticket=t");

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

describe("the live connection", () => {
  async function connected(poll: () => Promise<NotificationFeed | null>) {
    mount(poll, true, { liveUrl });
    await elapse(0);
    const socket = FakeSocket.all[0];
    act(() => socket.open());
    await elapse(0);
    return socket;
  }

  it("fetches the feed and toasts the moment a nudge arrives", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    const socket = await connected(poll);
    poll.mockClear();
    poll.mockResolvedValue(feedOf(ben, ada));

    act(() => socket.nudge());
    await elapse(0);

    expect(poll).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("Ben Cruz became a Customer");
    expect(screen.getByText("unread:2 new:u-2")).toBeTruthy();
  });

  it("toasts a new Order alert on a nudge and keeps the 5-second backstop poll running", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    const socket = await connected(poll);
    poll.mockClear();
    const order: Notification = { ...note("5", "Di Reyes"), kind: "order-placed", orderId: 1042 };
    poll.mockResolvedValue(feedOf(order, ada));

    act(() => socket.nudge());
    await elapse(0);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(screen.getByText("unread:2 new:")).toBeTruthy();

    poll.mockClear();
    await elapse(5_000);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("shows nothing new when the nudge finds nothing this Staff member may see", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    const socket = await connected(poll);

    act(() => socket.nudge());
    await elapse(0);

    expect(toast.info).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("unread:1 new:")).toBeTruthy();
  });

  it("does not open a connection for Staff without a bell", async () => {
    mount(vi.fn().mockResolvedValue(feedOf(ada)), false, { liveUrl });
    await elapse(0);

    expect(FakeSocket.all).toHaveLength(0);
  });

  it("fetches again when a nudge lands during a fetch, so the event is not missed", async () => {
    let release: (feed: NotificationFeed) => void = () => {};
    const poll = vi.fn().mockResolvedValueOnce(feedOf(ada));
    const socket = await connected(poll);
    poll.mockClear();
    poll.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    poll.mockResolvedValue(feedOf(ben, ada));

    act(() => socket.nudge());
    act(() => socket.nudge());
    await elapse(0);
    expect(poll).toHaveBeenCalledTimes(1);

    release(feedOf(ada));
    await elapse(0);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("keeps updating through the poll when the connection drops, and reconnects", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    const socket = await connected(poll);
    poll.mockClear();

    act(() => socket.close());
    poll.mockResolvedValue(feedOf(ben, ada));
    await elapse(5_000);

    expect(toast.info).toHaveBeenCalledWith("Ben Cruz became a Customer");
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("keeps polling when no connection can be issued", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    mount(poll, true, { liveUrl: () => Promise.resolve(null) });

    await elapse(5_000);

    expect(poll).toHaveBeenCalledTimes(1);
    expect(FakeSocket.all).toHaveLength(0);
  });

  it("closes the connection when the bell goes away", async () => {
    const socket = await connected(vi.fn().mockResolvedValue(feedOf(ada)));
    const close = vi.spyOn(socket, "close");

    cleanup();

    expect(close).toHaveBeenCalled();
    await elapse(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});

describe("reading from the bell", () => {
  function Reader({ id }: { id: string }) {
    const actions = useFeedActions();
    return <button onClick={() => actions.markRead(id)}>read</button>;
  }

  it("un-highlights the row at once and keeps it read when the server is slow", async () => {
    const markRead = vi.fn(() => new Promise<void>(() => {}));
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    render(
      <LiveUpdatesProvider initialFeed={feedOf(ada)} poll={poll} enabled markRead={markRead}>
        <Probe />
        <Reader id="1" />
      </LiveUpdatesProvider>,
    );

    await act(async () => screen.getByText("read").click());
    expect(markRead).toHaveBeenCalledWith("1");
    expect(screen.getByText("unread:0 new:")).toBeTruthy();

    // A poll that predates the read does not bring the highlight back.
    await elapse(5_000);
    expect(screen.getByText("unread:0 new:")).toBeTruthy();
  });

  it("clears the whole bell at once on mark all", async () => {
    const markAllRead = vi.fn(() => new Promise<void>(() => {}));
    function ReadAll() {
      return <button onClick={useFeedActions().markAllRead}>clear</button>;
    }
    render(
      <LiveUpdatesProvider initialFeed={feedOf(ben, ada)} poll={vi.fn()} enabled={false} markAllRead={markAllRead}>
        <Probe />
        <ReadAll />
      </LiveUpdatesProvider>,
    );

    await act(async () => screen.getByText("clear").click());
    expect(markAllRead).toHaveBeenCalled();
    expect(screen.getByText("unread:0 new:")).toBeTruthy();
  });

  it("only subtracts the rows read here from the server's unread count", async () => {
    render(
      <LiveUpdatesProvider initialFeed={{ unread: 5, notifications: [ben, ada] }} poll={vi.fn()} enabled={false}>
        <Probe />
        <Reader id="1" />
      </LiveUpdatesProvider>,
    );

    await act(async () => screen.getByText("read").click());
    expect(screen.getByText("unread:4 new:")).toBeTruthy();
  });

  it("leaves the row read when marking it fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const markRead = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <LiveUpdatesProvider initialFeed={feedOf(ada)} poll={vi.fn()} enabled={false} markRead={markRead}>
        <Probe />
        <Reader id="1" />
      </LiveUpdatesProvider>,
    );

    await act(async () => screen.getByText("read").click());
    expect(screen.getByText("unread:0 new:")).toBeTruthy();
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
