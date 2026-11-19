import { Skeleton } from "@/components/ui/skeleton";
import { ConversationsSkeleton } from "@/features/tickets/conversations-skeleton";

/** Static chrome renders as-is; only the data (chats, messages and the Customer and Ticket details) is skeleton. */
export default function Loading() {
  return (
    <div className="lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      <div className="grid w-full grid-cols-1 overflow-hidden bg-white lg:h-full lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
        <div className="border-b border-[#e6e1ee] p-3 lg:col-start-1 lg:row-start-1 lg:border-r">
          <Skeleton className="h-9 w-full" />
        </div>
        <ConversationsSkeleton />
      </div>
    </div>
  );
}
