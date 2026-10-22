import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CELL, COLUMNS, HEAD, STEPS, TABS } from "@/features/orders/payments-layout";
import { PAYMENTS_WINDOW_DAYS } from "@/features/orders/payments";

const STATS = ["Receipts to check", `Paid (${PAYMENTS_WINDOW_DAYS} days)`, "COD to collect", `Rejected (${PAYMENTS_WINDOW_DAYS} days)`];

/** Static chrome renders as-is; only the data (stat figures, counts, rows) is skeleton. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading payments"
      className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7"
    >
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Payments</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Customers send a GCash reference number and, optionally, a screenshot. Check it, then mark the Order paid or cancel it. Paid, collected and rejected cover the last 30 days.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <div className="flex shrink-0 gap-4">
          {STATS.map((label) => (
            <div
              key={label}
              className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]"
            >
              <p className="text-[13px] font-medium text-[#71717a]">{label}</p>
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-4 w-36" />
            </div>
          ))}
        </div>

        <div className="flex shrink-0 gap-1">
          {TABS.map(({ key, label }) => (
            <span
              key={key}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium leading-[normal] text-[#71717a]"
            >
              {label} <Skeleton className="h-4 w-5" />
            </span>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 gap-4">
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-[#e6e1ee] bg-white p-5">
            <div className="min-w-[860px]">
              <div className="flex items-center border-b border-[#efebf4] bg-white pt-1 pb-2 text-xs font-medium leading-[normal] text-[#6e6680]">
                {COLUMNS.map((col) => (
                  <div key={col.header || "action"} className={cn(HEAD, col.className)}>
                    {col.header}
                  </div>
                ))}
              </div>
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex items-center border-b border-[#efebf4] py-2.5">
                  {COLUMNS.map((col) => (
                    <div key={col.header || "action"} className={cn(CELL, col.className)}>
                      {col.header && <Skeleton className="h-4 w-3/4" />}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="hidden w-[340px] shrink-0 flex-col gap-4 overflow-hidden xl:flex">
            <section className="flex flex-col gap-3.5 rounded-xl border border-[#e6e1ee] bg-white p-5 leading-[normal]">
              <h2 className="text-[15px] font-semibold text-[#18181b]">How a payment is confirmed</h2>
              {STEPS.map(({ title, note }, i) => (
                <div key={title} className="flex items-start gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#efe6f8] text-xs font-semibold text-[#5b2a86]">
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="text-sm font-medium text-[#18181b]">{title}</p>
                    <p className="text-xs text-[#71717a]">{note}</p>
                  </div>
                </div>
              ))}
            </section>
            <section className="flex flex-col gap-3.5 rounded-xl border border-[#e6e1ee] bg-white p-5 leading-[normal]">
              <h2 className="text-[15px] font-semibold text-[#18181b]">Cash on delivery</h2>
              <p className="text-[13px] text-[#71717a]">
                No receipt needed. The Order ships as COD to collect and counts as collected once it is delivered.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
