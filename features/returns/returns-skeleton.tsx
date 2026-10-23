import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  CELL,
  COLUMNS,
  HEAD,
  RATE_CAPTION,
  STAT_LABELS,
  StatCard,
  TabNav,
  type ReturnListParams,
} from "./return-list";

/** Static chrome renders as-is; only the data (stats, counts and rows) is skeleton. */
export function ReturnsSkeleton({ params }: { params: ReturnListParams }) {
  return (
    <div role="status" aria-label="Loading Returns" className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
        {STAT_LABELS.map((label) => (
          <StatCard key={label} label={label} caption={label === "Return rate" ? RATE_CAPTION : undefined}>
            <Skeleton className="h-8 w-16" />
          </StatCard>
        ))}
      </div>

      <TabNav params={params} count={() => <Skeleton className="h-4 w-5" />} />

      <div className="flex min-h-0 flex-1 flex-col gap-[14px] rounded-xl border border-[#e6e1ee] bg-white p-5">
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="min-w-[760px]">
            <div className="flex items-center border-b border-[#efebf4] bg-white py-1.5 text-xs font-medium leading-[normal] text-[#6e6680]">
              {COLUMNS.map((col) => (
                <div key={col.header} className={cn(HEAD, col.className)}>
                  {col.header}
                </div>
              ))}
            </div>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="flex items-center border-b border-[#efebf4] py-[11px]">
                {COLUMNS.map((col) => (
                  <div key={col.header} className={cn(CELL, col.className)}>
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
