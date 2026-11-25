import { devBypassEnabled } from "@/lib/portal/dev-bypass";

/** Runs once at server start, so an unsafe local bypass stops CREOMS from starting at all. */
export function register() {
  devBypassEnabled();
}

/** Next.js calls this for every uncaught server error (pages, Server Actions, route handlers). */
export async function onRequestError(error: unknown, request: { path: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { isClientDisconnect, reportLiveError, requestErrorKind } = await import("@/lib/error-monitor");

  // A browser that left early is not a server error: no System log entry, no owner email.
  if (isClientDisconnect(error)) return;

  await reportLiveError(requestErrorKind(error, request.path.split("?")[0]), error);
}
