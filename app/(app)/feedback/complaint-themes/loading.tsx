import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading Complaint themes" className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <div className="shrink-0 space-y-1">
        <p className="text-xs text-[#6e6680]">Feedback / Complaint themes</p>
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Complaint themes</h1>
      </div>
      <Skeleton className="h-9 w-80 shrink-0" />
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full shrink-0 rounded-xl" />)}
    </div>
  );
}
