"use client";

import { useEffect, useState } from "react";
import { LoadingCard } from "./loading-card";

export const LOADING_DELAY_MS = 300;

/** Shows the loading card only once the wait passes the delay, so fast waits never flash it. */
export function DelayedLoadingCard({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), LOADING_DELAY_MS);

    return () => clearTimeout(timer);
  }, []);

  return visible ? <LoadingCard title={title} subtitle={subtitle} /> : null;
}
