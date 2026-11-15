import { Skeleton } from "@/components/ui/skeleton";

/** The page chrome renders as-is; only the cards are skeleton. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading failed delivery" className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Failed delivery</h1>
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}
