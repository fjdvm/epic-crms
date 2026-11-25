"use client";

import { useEffect } from "react";

import { offerRefreshIfStale } from "@/lib/stale-build";

/** Catches a stale Server Action call that no screen handled, anywhere in the app. */
export function StaleBuildListener() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (offerRefreshIfStale(event.reason)) event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
  return null;
}
