import { DelayedLoadingCard } from "./delayed-loading-card";

/** The loading card for moving between CREOMS pages, used by every route's loading file. */
export function PageLoading() {
  return <DelayedLoadingCard title="Loading…" subtitle="Getting this page ready" />;
}
