import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading Senior/PWD check" className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden px-8 py-7">
      <Skeleton className="h-4 w-32 shrink-0" />
      <Skeleton className="h-8 w-96 shrink-0" />
      <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[1.35fr_1fr]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  );
}
