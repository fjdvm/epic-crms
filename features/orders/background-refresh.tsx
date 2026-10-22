"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Orders change on the storefront where CREOMS cannot clear its cache, so a page is never older than this plus a render. */
export const REFRESH_INTERVAL_MS = 15_000;

/**
 * Keeps an Orders page fresh: the cached page shows at once, then this refreshes it in the
 * background on opening and every few seconds while the tab is visible (ADR-0002, Tickets tier).
 */
export function BackgroundRefresh() {
  const router = useRouter();
  const refresh = useRef(router.refresh);

  useEffect(() => {
    refresh.current = router.refresh;
  });

  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      refresh.current();
      timer ??= setInterval(() => refresh.current(), REFRESH_INTERVAL_MS);
    };

    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };

    const onVisibilityChange = () => (visible() ? start() : stop());

    if (visible()) start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
