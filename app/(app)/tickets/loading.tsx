import { Skeleton } from "@/components/ui/skeleton";
import { TicketListSkeleton } from "@/features/tickets/ticket-list";

/** Static chrome renders as-is; only the data (the filter choices, tabs, rows and paging) is skeleton. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading Tickets"
      className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7"
    >
      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">
            Tickets
          </h1>
          <p className="text-sm leading-[normal] text-[#6e6680]">
            Every Ticket, claimed or not, and who claimed it. Each links to a
            customer, and to an order when it is about one.
          </p>
        </div>
        <button
          type="button"
          disabled
          className="shrink-0 rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-white"
        >
          New ticket
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-[320px] max-w-full" />
        <Skeleton className="h-9 w-[130px]" />
        <Skeleton className="h-9 w-[130px]" />
        <Skeleton className="h-9 w-[130px]" />
      </div>

      <TicketListSkeleton announce={false} />
    </div>
  );
}
