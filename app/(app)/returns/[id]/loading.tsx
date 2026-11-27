import { BackButton } from "@/components/shared/back-button";
import { Skeleton } from "@/components/ui/skeleton";
import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";

/** The Return page's three columns, so nothing moves when the data arrives. */
const SKELETON_COLUMNS = [
  ["Reason", "Defect images", "Video"],
  ["Items"],
  ["Order", "Refund window", "History"],
];

/** Static chrome renders as-is; only the Return's own data is skeleton. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading Return"
      className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7"
    >
      <div className="shrink-0 space-y-2">
        <div className="self-start"><BackButton fallbackHref="/returns" label="Returns" /></div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-6 w-24" />
          </div>
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(0,1.25fr)_minmax(0,0.85fr)] grid-rows-[minmax(0,1fr)] gap-5">
        {SKELETON_COLUMNS.map((titles) => (
          <div key={titles[0]} className="min-h-0 space-y-5 overflow-hidden">
            {titles.map((title) => (
              <section key={title} className={CARD}>
                <h2 className={CARD_TITLE}>{title}</h2>
                <Skeleton className={title === "Items" ? "h-32 w-full" : "h-12 w-full"} />
              </section>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
