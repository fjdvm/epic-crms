import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CELL, COLUMNS } from "@/features/customer-profiles/customer-list";
import { STAGES } from "@/features/customer-profiles/customers";
import { STAGE_LABELS } from "@/features/customer-profiles/rules";

const TABS = ["All", ...STAGES.map((s) => STAGE_LABELS[s])];

/** Static chrome renders as-is; only the data (counts, rows, paging) is skeleton. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading customers" className="space-y-5 px-xl py-7">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Customer Profiles</h1>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Skeleton className="h-4 w-8" />
          <span>customers · one profile per person, matched by email or phone at checkout</span>
        </div>
      </div>

      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="relative w-full max-w-[24rem]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input disabled placeholder="Search name, email or contact number" className="pl-9" />
          </div>
          <Button disabled>
            <Plus className="size-4" /> Add customer
          </Button>
        </div>

        <nav aria-label="Stage" className="flex flex-wrap gap-1">
          {TABS.map((label) => (
            <span
              key={label}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground"
            >
              {label} <Skeleton className="h-4 w-5" />
            </span>
          ))}
        </nav>

        <div className="space-y-[14px] rounded-xl border border-border bg-card p-5">
          <div className="overflow-x-auto">
            <div className="min-w-[1010px]">
              <div className="flex items-center border-b border-border-subtle py-1.5 text-xs font-medium text-muted-foreground">
                {COLUMNS.map((col) => (
                  <div key={col.header} className={col.className}>
                    {col.header}
                  </div>
                ))}
              </div>
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex items-center border-b border-border-subtle last:border-0">
                  {COLUMNS.map((col) => (
                    <div key={col.header} className={cn(CELL, col.className)}>
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-8 w-32" />
          </div>

          <p className="rounded-lg bg-secondary px-3 py-2.5 text-xs text-muted-foreground">
            Lifecycle stage is calculated from orders: New = no order, First order = 1, Repeat = 2+, At
            risk = no order in 60 days, Lost = no order in 120 days.
          </p>
        </div>
      </div>
    </div>
  );
}
