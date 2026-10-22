import { Skeleton } from "@/components/ui/skeleton";
import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";
import { cn } from "@/lib/utils";

/** Static chrome renders as-is; only the data (chats, messages and the Customer and Ticket details) is skeleton. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading Conversations"
      className="flex flex-col gap-5 px-8 py-7 lg:h-[calc(100vh-4rem)] lg:overflow-hidden"
    >
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Conversations</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          One inbox for every Ticket chat, newest activity first. Each chat belongs to a Ticket.
        </p>
      </div>

      <div className="flex flex-col items-start gap-4 lg:min-h-0 lg:w-full lg:flex-1 lg:flex-row">
        <nav
          aria-label="Chats"
          className="flex h-[40vh] w-full flex-col gap-1 overflow-hidden rounded-xl border border-[#e6e1ee] bg-white px-2 py-3 lg:h-full lg:w-[300px] lg:shrink-0"
        >
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex flex-col gap-[6px] rounded-lg px-3 py-[10px]">
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-4 min-w-0 flex-1" />
                <Skeleton className="h-3 w-10" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </nav>

        <section
          aria-label="Chat"
          className={cn(CARD, "flex h-[70vh] min-h-0 w-full min-w-0 flex-col space-y-0 gap-3 lg:h-full lg:flex-1")}
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 min-w-0 flex-1" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="h-12 w-1/2 self-end" />
            <Skeleton className="h-12 w-3/5" />
          </div>
        </section>

        <div className="w-full space-y-4 lg:h-full lg:w-[320px] lg:shrink-0 lg:overflow-hidden">
          <section aria-label="Customer" className={CARD}>
            <h2 className={CARD_TITLE}>Customer</h2>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </section>
          <section aria-label="Ticket" className={CARD}>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </section>
        </div>
      </div>
    </div>
  );
}
