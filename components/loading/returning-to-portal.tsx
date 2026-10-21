import { DelayedLoadingCard } from "./delayed-loading-card";

/** The loading card while the browser goes back to the Portal: on Log out, or from the module switcher. */
export function ReturningToPortal({ subtitle }: { subtitle: string }) {
  return <DelayedLoadingCard title="Returning to the Portal…" subtitle={subtitle} />;
}
