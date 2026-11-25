import { toast } from "sonner";

/** Shown once per tab: further stale calls reuse the same toast. */
export const STALE_BUILD_TOAST_ID = "stale-build";

/**
 * A tab opened before a deploy still calls the old build's Server Actions, which the new server
 * no longer has. Offers a one-click refresh instead of failing quietly. True when it was that error.
 */
export function offerRefreshIfStale(error: unknown): boolean {
  // Matched by name, as Next.js names it, so it also works across bundles.
  if (!(error instanceof Error) || error.name !== "UnrecognizedActionError") return false;
  toast("A new version of CREOMS is available.", {
    id: STALE_BUILD_TOAST_ID,
    description: "Refresh to keep working; anything you have typed on this page will be lost.",
    duration: Infinity,
    action: { label: "Refresh", onClick: () => window.location.reload() },
  });
  return true;
}
