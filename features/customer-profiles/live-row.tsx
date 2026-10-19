"use client";

import { useNewCustomerIds } from "@/features/notifications/live-updates";
import { cn } from "@/lib/utils";

/** A list row that shows a temporary "New" highlight while its Customer has just arrived. */
export function LiveRow({ customerId, className, children }: { customerId: string; className: string; children: React.ReactNode }) {
  const isNew = useNewCustomerIds().has(customerId);

  return (
    <div
      data-new={isNew || undefined}
      className={cn(className, isNew && "bg-accent transition-colors")}
    >
      {isNew && (
        <span className="absolute left-1 top-1/2 -translate-y-1/2 rounded bg-primary px-1 text-[10px] font-semibold uppercase leading-4 text-primary-foreground">
          New
        </span>
      )}
      {children}
    </div>
  );
}
