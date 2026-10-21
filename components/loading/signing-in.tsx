"use client";

import { useEffect } from "react";
import { DelayedLoadingCard } from "./delayed-loading-card";

/** Holds the page while the browser goes to the Portal, so a slow handoff shows the loading card. */
export function SigningIn({
  loginUrl,
  navigate = (url) => window.location.replace(url),
}: {
  loginUrl: string;
  navigate?: (url: string) => void;
}) {
  useEffect(() => {
    navigate(loginUrl);
  }, [loginUrl, navigate]);

  return (
    <DelayedLoadingCard
      title="Opening CRMS…"
      subtitle="Handing your sign-in over securely"
    />
  );
}
