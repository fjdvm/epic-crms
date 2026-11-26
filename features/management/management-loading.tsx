import { Skeleton } from "@/components/ui/skeleton";

function CardSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div data-testid="settings-card-skeleton" className="flex flex-col gap-3 rounded-xl border border-[#e6e1ee] bg-white p-5">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className={tall ? "h-40 w-full" : "h-9 w-full"} />
    </div>
  );
}

/** Static chrome renders as-is; the body mirrors the page's groups of setting cards. */
export function ManagementLoading() {
  return (
    <div
      role="status"
      aria-label="Loading Commerce Settings"
      className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7"
    >
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Commerce Settings</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">Shop rules for payment accounts, delivery, approvals, service levels and automatic checks.</p>
      </div>
      <div className="min-h-0 flex-1 space-y-8 overflow-hidden">
        <div className="space-y-3">
          <Skeleton className="h-3 w-24" />
          <CardSkeleton tall />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-3 w-32" />
          <div className="grid grid-cols-2 gap-5">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}
