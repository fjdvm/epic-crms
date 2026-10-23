import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CELL, COLUMNS, HEAD, STAT_LABELS, StatCard, TAB_LABELS } from "@/features/returns/return-list";
import { RETURN_TABS } from "@/features/returns/returns";

/** Static chrome renders as-is; only the data (stats, counts and rows) is skeleton. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading Returns"
      className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7"
    >
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Returns</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Customers&apos; requests to refund Order items, shown here as the store has them
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
          {STAT_LABELS.map((label) => (
            <StatCard key={label} label={label} caption={label === "Return rate" ? "Of delivered Orders" : undefined}>
              <Skeleton className="h-8 w-16" />
            </StatCard>
          ))}
        </div>

        <nav className="flex shrink-0 gap-1 overflow-x-auto" aria-label="Return tabs">
          {RETURN_TABS.map((tab) => (
            <span
              key={tab}
              className="flex items-center gap-1.5 rounded-lg px-[14px] py-2 text-sm font-medium leading-[normal] whitespace-nowrap text-[#6e6680]"
            >
              {TAB_LABELS[tab]} <Skeleton className="h-4 w-5" />
            </span>
          ))}
        </nav>

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
    </div>
  );
}
