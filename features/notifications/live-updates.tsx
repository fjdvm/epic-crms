"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { describeNotification } from "./describe";
import type { NotificationFeed } from "./notifications";

export const POLL_INTERVAL_MS = 5_000;
/** How long a new Customer stays highlighted as New in the list. */
export const HIGHLIGHT_MS = 10_000;
const PING_INTERVAL_MS = 30_000;
const MAX_RECONNECT_MS = 30_000;
const STABLE_MS = 10_000;

const FeedContext = createContext<NotificationFeed | null>(null);
const NewCustomerContext = createContext<ReadonlySet<string>>(new Set());

export interface FeedActions {
  /** Un-highlights the row at once, then tells the server. */
  markRead: (id: string) => void;
  markAllRead: () => void;
}

const ActionsContext = createContext<FeedActions>({ markRead: () => {}, markAllRead: () => {} });

/** What the bell does when a row is opened or everything is cleared. */
export function useFeedActions(): FeedActions {
  return useContext(ActionsContext);
}

/** The bell's feed, kept current by the provider's polling. */
export function useLiveFeed(): NotificationFeed | null {
  return useContext(FeedContext);
}

/** Ids of Customers who just arrived and should show as New. */
export function useNewCustomerIds(): ReadonlySet<string> {
  return useContext(NewCustomerContext);
}

/**
 * Keeps the feed current without a refresh. `poll` asks the server for the latest feed. A nudge
 * on the shared Staff channel (`liveUrl` issues its socket address) makes the provider ask at
 * once; the poll stays as a backstop for a lost nudge or a dropped connection. A nudge carries
 * nothing, so what the Staff member may see is decided only when the feed is fetched.
 *
 * Polls only while the tab is visible. Each tab toasts a notification at most once; the
 * notifications themselves are one per Customer in the database, so tabs never duplicate them.
 */
export function LiveUpdatesProvider({
  initialFeed,
  poll,
  enabled,
  intervalMs = POLL_INTERVAL_MS,
  liveUrl,
  markRead,
  markAllRead,
  children,
}: {
  initialFeed: NotificationFeed | null;
  /** Resolves to the latest feed, or null when it could not be read. */
  poll: () => Promise<NotificationFeed | null>;
  enabled: boolean;
  intervalMs?: number;
  /** Resolves to the socket address for the Staff channel, or null when none can be issued. */
  liveUrl?: () => Promise<string | null>;
  markRead?: (id: string) => Promise<unknown>;
  markAllRead?: () => Promise<unknown>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [received, setFeed] = useState(initialFeed);
  // Rows read here stay read over any feed fetched before the server caught up; a row never goes back to unread.
  const [readHere, setReadHere] = useState<ReadonlySet<string>>(new Set());
  const [serverFeed, setServerFeed] = useState(initialFeed);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const seen = useRef(new Set(initialFeed?.notifications.map((n) => n.id)));
  const pollRef = useRef(poll);
  const liveUrlRef = useRef(liveUrl);
  const refreshRef = useRef(router.refresh);

  useEffect(() => {
    pollRef.current = poll;
    liveUrlRef.current = liveUrl;
    refreshRef.current = router.refresh;
  });

  const feed = useMemo(() => {
    if (!received || readHere.size === 0) return received;

    // The server's unread count covers rows beyond the listed ones, so only subtract what was read here.
    const newlyRead = received.notifications.filter((n) => !n.read && readHere.has(n.id)).length;
    const notifications = received.notifications.map((n) => (readHere.has(n.id) ? { ...n, read: true } : n));

    return { notifications, unread: Math.max(0, received.unread - newlyRead) };
  }, [received, readHere]);

  const actions = useMemo<FeedActions>(() => {
    const failed = (error: unknown) => console.error("Marking notifications read failed", error);

    return {
      markRead: (id) => {
        setReadHere((current) => new Set([...current, id]));
        void markRead?.(id)?.catch(failed);
      },
      markAllRead: () => {
        setReadHere((current) => new Set([...current, ...(received?.notifications.map((n) => n.id) ?? [])]));
        void markAllRead?.()?.catch(failed);
      },
    };
  }, [markRead, markAllRead, received]);

  // A fresh server render (e.g. after marking read) wins over the last poll.
  if (initialFeed !== serverFeed) {
    setServerFeed(initialFeed);
    setFeed(initialFeed);
  }

  useEffect(() => {
    for (const n of initialFeed?.notifications ?? []) seen.current.add(n.id);
  }, [initialFeed]);

  useEffect(() => {
    if (!enabled) return;

    const highlightTimers = new Set<ReturnType<typeof setTimeout>>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let stopped = false;

    const visible = () => document.visibilityState === "visible";

    const receive = (next: NotificationFeed) => {
      const arrived = next.notifications.filter((n) => !seen.current.has(n.id));

      setFeed(next);
      if (arrived.length === 0) return;

      for (const n of arrived) {
        seen.current.add(n.id);
        toast.info(describeNotification(n).text);
      }

      // Only a New Customer shows as New in the list; Ticket alerts name no Customer row.
      const ids = arrived.filter((n) => n.kind === "new-customer").map((n) => n.customerId);

      if (ids.length > 0) {
        setFresh((current) => new Set([...current, ...ids]));
        const expire = setTimeout(() => {
          highlightTimers.delete(expire);
          setFresh((current) => new Set([...current].filter((id) => !ids.includes(id))));
        }, HIGHLIGHT_MS);
        highlightTimers.add(expire);
      }

      refreshRef.current();
    };

    // Asks for the latest feed. A request that lands mid-fetch is queued, since the fetch in
    // flight may have been answered before the event it was nudged about.
    let queued = false;

    const refresh = async () => {
      clearTimeout(timer);
      timer = undefined;
      if (stopped || !visible()) {
        queued = false;
        return;
      }
      if (running) {
        queued = true;
        return;
      }

      running = true;
      try {
        const next = await pollRef.current();
        if (next && !stopped) receive(next);
      } catch (error) {
        console.error("Live update poll failed", error);
      } finally {
        running = false;
      }

      if (stopped) return;
      if (queued) {
        queued = false;
        void refresh();
      } else if (visible()) {
        timer = setTimeout(refresh, intervalMs);
      }
    };

    const onVisibilityChange = () => {
      if (visible()) {
        if (timer === undefined && !running) void refresh();
      } else {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    let socket: WebSocket | undefined;
    let pinger: ReturnType<typeof setInterval> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const scheduleReconnect = () => {
      if (stopped) return;
      reconnect = setTimeout(connect, Math.min(MAX_RECONNECT_MS, 1_000 * 2 ** attempts++));
    };

    const connect = async () => {
      reconnect = undefined;
      if (stopped || !liveUrlRef.current) return;

      let url: string | null = null;
      try {
        url = await liveUrlRef.current();
      } catch (error) {
        console.error("Live connection could not be issued", error);
      }
      if (stopped) return;
      if (!url) return scheduleReconnect();

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (error) {
        console.error("Live connection failed", error);
        return scheduleReconnect();
      }

      let openedAt = Infinity;
      socket = ws;
      ws.onopen = () => {
        openedAt = Date.now();
        pinger = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, PING_INTERVAL_MS);
        // Anything nudged before the connection was up.
        void refresh();
      };
      ws.onmessage = (event) => {
        if (event.data !== "pong") void refresh();
      };
      ws.onclose = () => {
        clearInterval(pinger);
        // Only a connection that held counts as healthy, so one that closes at once keeps backing off.
        if (Date.now() - openedAt >= STABLE_MS) attempts = 0;
        if (socket !== ws) return;
        socket = undefined;
        scheduleReconnect();
      };
    };

    if (visible()) timer = setTimeout(refresh, intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(reconnect);
      clearInterval(pinger);
      const closing = socket;
      socket = undefined;
      closing?.close();
      highlightTimers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs]);

  return (
    <FeedContext.Provider value={feed}>
      <NewCustomerContext.Provider value={fresh}>
        <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
      </NewCustomerContext.Provider>
    </FeedContext.Provider>
  );
}
