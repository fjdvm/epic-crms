import { Skeleton } from "@/components/ui/skeleton";

/** Static chrome renders as-is; only the rows are skeleton. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading Senior/PWD verification" className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Senior/PWD verification</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Check the account name, the ID photo and its number, then approve or decline. The photo is deleted right after review.
        </p>
      </div>
      <div className="rounded-xl border border-[#e6e1ee] bg-white p-5">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="my-3 h-10 w-full" />)}
      </div>
    </div>
  );
}
