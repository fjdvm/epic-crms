import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { COLUMNS, HEAD, CELL, TAB_LABELS } from "@/features/orders/order-list";
import { ORDER_TABS } from "@/features/orders/orders";

/** Static chrome renders as-is; only the data (counts, rows, paging) is skeleton. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading Orders"
      className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7"
    >
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Orders</h1>
        <div className="flex items-center gap-1.5 text-sm leading-[normal] text-[#6e6680]">
          <Skeleton className="h-4 w-8" />
          <span>Orders · placed on the store, shown here as the store has them</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <nav className="flex shrink-0 gap-1 overflow-x-auto" aria-label="Order tabs">
          {ORDER_TABS.map((tab) => (
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
            <div className="min-w-[860px]">
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
