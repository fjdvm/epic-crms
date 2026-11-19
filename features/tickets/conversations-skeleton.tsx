import { Skeleton } from "@/components/ui/skeleton";

/** The inbox and chat as skeleton, shown at once while a chat or a search loads. */
export function ConversationsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading Conversations"
      className="flex w-full flex-col overflow-hidden rounded-xl border border-[#e6e1ee] bg-white lg:min-h-0 lg:flex-1 lg:flex-row"
    >
      <nav
        aria-label="Chats"
        className="flex h-[40vh] w-full flex-col overflow-hidden border-b border-[#e6e1ee] lg:h-full lg:w-[300px] lg:shrink-0 lg:border-r lg:border-b-0"
      >
        <div className="flex gap-1 p-3">
          <Skeleton className="h-6 w-14" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-10" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 border-b border-[#f0ecf5] px-4 py-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </nav>

      <section aria-label="Chat" className="flex h-[70vh] min-h-0 w-full min-w-0 flex-col lg:h-full lg:flex-1">
        <div className="flex items-center gap-2 border-b border-[#e6e1ee] px-5 py-3">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 bg-[#faf9fc] p-5">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-12 w-1/2 self-end" />
          <Skeleton className="h-12 w-3/5" />
        </div>
      </section>
    </div>
  );
}
