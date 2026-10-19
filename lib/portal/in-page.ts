import type { Staff } from "./client";
import { accessFor } from "./access";

/** What an in-page request (loading table rows, say) gets back instead of a redirect. */
export type Guarded<T> =
  | { status: "ok"; value: T }
  | { status: "session-ended" | "unavailable" | "no-access" };

export const SESSION_ENDED_MESSAGE = "Your session ended. Signing you in again…";
export const UNAVAILABLE_MESSAGE = "The Portal is temporarily unavailable. Please try again shortly.";
export const NO_ACCESS_MESSAGE = "You no longer have access to this page.";

/** Runs `load` only when the Portal allows the Module right now; otherwise says why not. */
export async function guarded<T>(
  access: ReturnType<typeof accessFor>,
  module: string,
  load: (staff: Staff) => Promise<T>,
): Promise<Guarded<T>> {
  const result = await access.check(module);

  switch (result.decision) {
    case "allowed":
      return { status: "ok", value: await load(result.staff) };
    case "invalid":
      return { status: "session-ended" };
    case "denied":
      return { status: "no-access" };
    case "unavailable":
      return { status: "unavailable" };
  }
}

/**
 * Client side of an in-page request: hands back the value, or shows the short message and,
 * for an ended session, goes to the Portal login and back to this page.
 */
export function settle<T>(
  result: Guarded<T>,
  ui: { notify(message: string): void; goTo(url: string): void; loginUrl: string },
  redirectDelayMs = 1500,
): T | undefined {
  if (result.status === "ok") {
    return result.value;
  }

  if (result.status === "session-ended") {
    ui.notify(SESSION_ENDED_MESSAGE);
    setTimeout(() => ui.goTo(ui.loginUrl), redirectDelayMs);
  } else if (result.status === "no-access") {
    ui.notify(NO_ACCESS_MESSAGE);
  } else {
    ui.notify(UNAVAILABLE_MESSAGE);
  }

  return undefined;
}
