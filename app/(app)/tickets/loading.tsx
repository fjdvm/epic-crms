import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CELL, COLUMNS, HEAD, TAB_LABELS } from "@/features/tickets/ticket-list";
import { TICKET_TABS } from "@/features/tickets/tickets";

/** Static chrome renders as-is; only the data (counts, rows, paging) is skeleton. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading Tickets"
      className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7"
    >
      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Tickets</h1>
          <div className="flex items-center gap-1.5 text-sm leading-[normal] text-[#6e6680]">
            <Skeleton className="h-4 w-6" />
            <span>open ·</span>
            <Skeleton className="h-4 w-6" />
            <span>overdue · each ticket links to a customer, and to an order when it is about one</span>
          </div>
        </div>
        <button
          type="button"
          disabled
          className="shrink-0 rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-white"
        >
          New ticket
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <nav className="flex shrink-0 gap-1" aria-label="Ticket tabs">
          {TICKET_TABS.map((tab) => (
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
            <div className="min-w-[740px]">
              <div className="flex items-center border-b border-[#efebf4] bg-white py-1.5 text-xs font-medium leading-[normal] text-[#6e6680]">
                {COLUMNS.map((col) => (
                  <div key={col.header} className={cn(HEAD, col.className)}>
                    {col.header}
                  </div>
                ))}
              </div>
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="flex items-center border-b border-[#efebf4] py-[11px]">
                  {COLUMNS.map((col, c) => (
                    <div key={c} className={cn(CELL, col.className)}>
                      {col.header && <Skeleton className="h-4 w-3/4" />}
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
