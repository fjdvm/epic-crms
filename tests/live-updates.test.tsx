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

const { toast, refresh } = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { info: vi.fn() }), refresh: vi.fn() }));
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
    <LiveUpdatesProvider initialFeed={feedOf(ada)} poll={poll} enabled={enabled} liveUrl={liveUrl} {...extra}>
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

async function nudge() {
  await elapse(0);
  act(() => FakeSocket.all[0].nudge());
  await elapse(0);
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
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("live updates", () => {
  it("makes no periodic data requests or data timers in an idle connected tab", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    mount(poll, true, { liveUrl });
    await elapse(0);
    act(() => FakeSocket.all[0].open());
    await elapse(0);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1); // Heartbeat only.
    poll.mockClear();
    await elapse(120_000);
    expect(poll).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
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

    await nudge();

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("Ben Cruz became a Customer");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("unread:2 new:u-2")).toBeTruthy();

    await nudge();
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("toasts a Ticket alert once without marking any Customer as New", async () => {
    const alert: Notification = { ...note("3", "Cy Tan"), kind: "ticket-message", ticketId: 208 };
    mount(vi.fn().mockResolvedValue(feedOf(alert, ada)));

    await nudge();
    await nudge();

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("Cy Tan sent a message on TKT-208");
    expect(screen.getByText("unread:2 new:")).toBeTruthy();
  });

  it("drops the New highlight after a while", async () => {
    mount(vi.fn().mockResolvedValue(feedOf(ben, ada)));

    await nudge();
    expect(screen.getByText("unread:2 new:u-2")).toBeTruthy();

    await elapse(15_000);
    expect(screen.getByText("unread:2 new:")).toBeTruthy();
  });

  it("keeps the last feed when a refresh cannot be answered", async () => {
    const poll = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount(poll);

    await nudge();
    await nudge();
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

  it("toasts a new Order notification on a nudge without a backstop poll", async () => {
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
    await elapse(60_000);
    expect(poll).not.toHaveBeenCalled();
  });

  it("catches up on connect even while hidden and ignores heartbeat replies", async () => {
    setVisibility("hidden");
    const poll = vi.fn().mockResolvedValue(feedOf(ben, ada));
    const socket = await connected(poll);
    expect(screen.getByText("unread:2 new:u-2")).toBeTruthy();
    poll.mockClear();
    act(() => socket.onmessage?.({ data: "pong" }));
    await elapse(60_000);
    expect(poll).not.toHaveBeenCalled();
  });

  it("does not fetch when the tab is hidden and shown again", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    await connected(poll);
    poll.mockClear();
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    await elapse(60_000);
    expect(poll).not.toHaveBeenCalled();
  });

  it("offers a Refresh instead of logging when the tab is older than the server", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stale = Object.assign(new Error("Server Action was not found on the server."), { name: "UnrecognizedActionError" });
    const poll = vi.fn().mockRejectedValue(stale);
    await connected(poll);
    expect(toast).toHaveBeenCalledWith("A new version of CREOMS is available.", expect.objectContaining({ id: "stale-build" }));
    expect(error).not.toHaveBeenCalledWith("Live feed refresh failed", stale);
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

  it("catches up only after reconnecting following a socket drop or service restart", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    const socket = await connected(poll);
    poll.mockClear();

    act(() => socket.close());
    poll.mockResolvedValue(feedOf(ben, ada));
    await elapse(2_000);
    expect(poll).not.toHaveBeenCalled();
    expect(FakeSocket.all).toHaveLength(2);

    act(() => FakeSocket.all[1].open());
    await elapse(0);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("Ben Cruz became a Customer");
    expect(screen.getByText("unread:2 new:u-2")).toBeTruthy();
  });

  it("retries unavailable Live tickets without fetching data on a timer", async () => {
    const poll = vi.fn().mockResolvedValue(feedOf(ada));
    const issue = vi.fn().mockResolvedValueOnce(null).mockResolvedValue("wss://gateway/live?ticket=fresh");
    mount(poll, true, { liveUrl: issue });
    await elapse(2_000);
    expect(issue).toHaveBeenCalledTimes(2);
    expect(poll).not.toHaveBeenCalled();
    act(() => FakeSocket.all[0].open());
    await elapse(0);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("reconnects with exponential backoff and jitter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const socket = await connected(vi.fn().mockResolvedValue(feedOf(ada)));
    act(() => socket.close());
    await elapse(749);
    expect(FakeSocket.all).toHaveLength(1);
    await elapse(1);
    expect(FakeSocket.all).toHaveLength(2);
    act(() => FakeSocket.all[1].close());
    await elapse(1_499);
    expect(FakeSocket.all).toHaveLength(2);
    await elapse(1);
    expect(FakeSocket.all).toHaveLength(3);
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
      <LiveUpdatesProvider initialFeed={feedOf(ada)} poll={poll} enabled liveUrl={liveUrl} markRead={markRead}>
        <Probe />
        <Reader id="1" />
      </LiveUpdatesProvider>,
    );

    await act(async () => screen.getByText("read").click());
    expect(markRead).toHaveBeenCalledWith("1");
    expect(screen.getByText("unread:0 new:")).toBeTruthy();

    // A feed that predates the read does not bring the highlight back.
    await nudge();
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
      <LiveUpdatesProvider initialFeed={feedOf(ada)} poll={vi.fn().mockResolvedValue(feedOf(ben, ada))} enabled liveUrl={liveUrl}>
        <LiveRow customerId="u-2" className="row">Ben</LiveRow>
        <LiveRow customerId="u-1" className="row">Ada</LiveRow>
      </LiveUpdatesProvider>,
    );
    await nudge();

    expect(screen.getByText("Ben").getAttribute("data-new")).toBe("true");
    expect(screen.getByText("Ada").getAttribute("data-new")).toBeNull();
    expect(screen.getAllByText("New")).toHaveLength(1);
  });
});
