"use client";

import { toast } from "sonner";
import { LOGIN_PATH } from "@/lib/portal/config";
import { settle, type Guarded } from "@/lib/portal/in-page";

/** Unwraps the result of a guarded server action, showing the message when it was refused. */
export function useGuarded() {
  return function unwrap<T>(result: Guarded<T>): T | undefined {
    const returnTo = `${window.location.pathname}${window.location.search}`;

    return settle(result, {
      notify: (message) => toast(message),
      goTo: (url) => window.location.assign(url),
      loginUrl: `${LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`,
    });
  };
}
