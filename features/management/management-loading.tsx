import { Skeleton } from "@/components/ui/skeleton";

/** Static chrome renders as-is; only the body is skeleton. */
export function ManagementLoading() {
  return (
    <div
      role="status"
      aria-label="Loading Commerce Settings"
      className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7"
    >
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Commerce Settings</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">Shop rules for payment accounts and delivery.</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-xl border border-[#e6e1ee] bg-white p-5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
