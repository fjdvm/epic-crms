"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LoadingCard } from "./loading-card";

export const LOADING_DELAY_MS = 300;

/**
 * Shows the loading card only once the wait passes the delay, so fast waits never flash it.
 * Portalled to the body: the page template's animation and the sidebar would otherwise trap the
 * fixed card inside them, and an open dialog would cover it.
 */
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

  return visible ? createPortal(<LoadingCard title={title} subtitle={subtitle} />, document.body) : null;
}
