import { Skeleton } from "@/components/ui/skeleton";
import { ConversationsSkeleton } from "@/features/tickets/conversations-skeleton";

/** Static chrome renders as-is; only the data (chats, messages and the Customer and Ticket details) is skeleton. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 px-8 py-7 lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">
            Conversations
          </h1>
          <p className="text-sm leading-[normal] text-[#6e6680]">
            Your claimed Tickets, one chat each, newest activity first. To read
            any other Ticket, open it from Tickets.
          </p>
        </div>
        <Skeleton className="h-9 w-[320px] max-w-full" />
      </div>
      <ConversationsSkeleton />
    </div>
  );
}
