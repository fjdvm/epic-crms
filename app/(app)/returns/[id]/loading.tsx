import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";

/** Static chrome renders as-is; only the Return's own data is skeleton. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading Return"
      className="flex flex-col gap-5 px-8 py-7 lg:h-[calc(100vh-4rem)] lg:overflow-hidden"
    >
      <div className="shrink-0 space-y-2">
        <Link href="/returns" className="text-sm font-medium text-[#5b2a86]">
          ← Returns
        </Link>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-6 w-24" />
          </div>
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:overflow-y-auto">
        <div className="space-y-5">
          {["Reason", "Defect images", "Items"].map((title) => (
            <section key={title} className={CARD}>
              <h2 className={CARD_TITLE}>{title}</h2>
              <Skeleton className="h-16 w-full" />
            </section>
          ))}
        </div>
        <div className="space-y-5">
          {["History", "Order", "Delivery photo"].map((title) => (
            <section key={title} className={CARD}>
              <h2 className={CARD_TITLE}>{title}</h2>
              <Skeleton className="h-12 w-full" />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
