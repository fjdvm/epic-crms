import { Skeleton } from "@/components/ui/skeleton";

/** The static chrome renders as it is; only the rows are skeleton. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading Senior/PWD checks" className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden px-8 py-7">
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Senior/PWD checks</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Customers upload an ID on the storefront. Their order can&apos;t be confirmed until the ID is reviewed.
        </p>
      </div>
      <Skeleton className="h-8 w-72 shrink-0" />
      <div className="rounded-xl border border-[#e6e1ee] bg-white p-5">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="my-3 h-10 w-full" />)}
      </div>
    </div>
  );
}
