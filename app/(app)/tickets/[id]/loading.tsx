import { BackButton } from "@/components/shared/back-button";
import { Skeleton } from "@/components/ui/skeleton";
import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";

/** Static chrome renders as-is; only the Ticket's own data is skeleton. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading Ticket" className="flex flex-col gap-5 px-8 py-7">
      <div className="space-y-2">
        <div className="self-start"><BackButton fallbackHref="/tickets" label="Tickets" /></div>
        <div className="space-y-2">
          <Skeleton className="h-8 w-80 max-w-full" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className={CARD}>
          <h2 className={CARD_TITLE}>Conversation</h2>
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-12 w-1/2" />
        </section>
        <div className="space-y-5">
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Customer</h2>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </section>
        </div>
      </div>
    </div>
  );
}
