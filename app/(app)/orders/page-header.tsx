import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";

/** `count` is the store's Order total; without it (while loading) that figure is a skeleton. */
export function PageHeader({ count }: { count?: number }) {
  return (
    <div className="shrink-0 space-y-1">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Orders</h1>
        <Link href="/orders/stock" prefetch className="rounded-lg border border-[#e4e4e7] bg-white px-3.5 py-[9px] text-sm font-medium text-[#18181b]">
          Products &amp; stock
        </Link>
      </div>
      <div className="flex items-center gap-1.5 text-sm leading-[normal] text-[#6e6680]">
        {count === undefined ? <Skeleton className="h-4 w-8" /> : <span>{count}</span>}
        <span>Orders · placed on the store, shown here as the store has them</span>
      </div>
    </div>
  );
}
