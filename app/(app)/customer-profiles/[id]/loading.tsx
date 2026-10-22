import { BackButton } from "@/components/shared/back-button";
import { Skeleton } from "@/components/ui/skeleton";
import { TabCard } from "@/features/customer-profiles/tab-card";

const STATS = ["Total spent", "Average order", "Last order", "Feedback given"];
const TABS = ["Orders", "Cart", "Feedback", "Emails", "Details"];
const HEAD = "py-1.5 text-left text-xs font-medium text-muted-foreground";
const ORDER_COLUMNS = ["Order", "Date", "Items", "Total", "Payment", "Status"];

/** Static chrome renders as-is; only the customer's own data is skeleton. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading customer" className="px-xl py-7">
      <div className="space-y-5">
        <BackButton fallbackHref="/customer-profiles" label="Customer Profiles" />

        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {STATS.map((title) => (
            <div
              key={title}
              className="flex h-full min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card px-5 py-4"
            >
              <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          ))}
        </div>

        <div className="space-y-5">
          <div className="flex flex-wrap gap-1">
            {TABS.map((tab) => (
              <span key={tab} className="rounded-lg px-3.5 py-2 text-sm text-muted-foreground">
                {tab}
              </span>
            ))}
          </div>

          <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
            <div className="min-w-0 w-full flex-1">
              <div className="h-full space-y-[14px] rounded-xl border border-border bg-card p-5">
                <h2 className="text-base font-semibold text-foreground">Order history</h2>
                <div className="flex border-b border-border-subtle">
                  {ORDER_COLUMNS.map((col) => (
                    <div key={col} className={`${HEAD} flex-1`}>
                      {col}
                    </div>
                  ))}
                </div>
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            </div>

            <aside className="w-full shrink-0 xl:w-[380px] [&>div]:h-full">
              <TabCard title="Activity timeline">
                <div className="space-y-[14px]">
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              </TabCard>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
