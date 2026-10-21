"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { describeNotification } from "./describe";
import type { NotificationFeed } from "./notifications";

export const POLL_INTERVAL_MS = 5_000;
/** How long a new Customer stays highlighted as New in the list. */
export const HIGHLIGHT_MS = 10_000;

const FeedContext = createContext<NotificationFeed | null>(null);
const NewCustomerContext = createContext<ReadonlySet<string>>(new Set());

/** The bell's feed, kept current by the provider's polling. */
export function useLiveFeed(): NotificationFeed | null {
  return useContext(FeedContext);
}

/** Ids of Customers who just arrived and should show as New. */
export function useNewCustomerIds(): ReadonlySet<string> {
  return useContext(NewCustomerContext);
}

/**
 * Keeps the feed current without a refresh. Polling is the delivery mechanism and lives only
 * here: `poll` asks the server for the latest feed, so a push can replace this loop later
 * without touching the bell, the toast or the list.
 *
 * Polls only while the tab is visible. Each tab toasts a notification at most once; the
 * notifications themselves are one per Customer in the database, so tabs never duplicate them.
 */
export function LiveUpdatesProvider({
  initialFeed,
  poll,
  enabled,
  intervalMs = POLL_INTERVAL_MS,
  children,
}: {
  initialFeed: NotificationFeed | null;
  /** Resolves to the latest feed, or null when it could not be read. */
  poll: () => Promise<NotificationFeed | null>;
  enabled: boolean;
  intervalMs?: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [feed, setFeed] = useState(initialFeed);
  const [serverFeed, setServerFeed] = useState(initialFeed);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const seen = useRef(new Set(initialFeed?.notifications.map((n) => n.id)));
  const pollRef = useRef(poll);
  const refreshRef = useRef(router.refresh);

  useEffect(() => {
    pollRef.current = poll;
    refreshRef.current = router.refresh;
  });

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

    const tick = async () => {
      timer = undefined;
      if (stopped || running || !visible()) return;

      running = true;
      try {
        const next = await pollRef.current();
        if (next && !stopped) receive(next);
      } catch (error) {
        console.error("Live update poll failed", error);
      } finally {
        running = false;
      }

      if (!stopped && visible()) timer = setTimeout(tick, intervalMs);
    };

    const onVisibilityChange = () => {
      if (visible()) {
        if (timer === undefined && !running) void tick();
      } else {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    if (visible()) timer = setTimeout(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopped = true;
      clearTimeout(timer);
      highlightTimers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs]);

  return (
    <FeedContext.Provider value={feed}>
      <NewCustomerContext.Provider value={fresh}>{children}</NewCustomerContext.Provider>
    </FeedContext.Provider>
  );
}
