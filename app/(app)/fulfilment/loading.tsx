import { Skeleton } from "@/components/ui/skeleton";
import { TABS } from "@/features/orders/fulfilment";
import { BOARD_COLUMNS, COLUMN_FRAME, COLUMNS_FRAME, PAGE_FRAME } from "@/features/orders/fulfilment-layout";
import { MoveRules } from "@/features/orders/move-rules";

/** Static chrome renders as-is, in the board's own frame; only the data (counts and cards) is skeleton. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading Fulfilment" className={PAGE_FRAME}>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Fulfilment</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Pick a tab to see what needs packing, what is out with a courier and what failed. Each move updates the Order&apos;s status on the store.
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <div className="flex flex-wrap gap-1">
          {TABS.map(({ key, label }) => (
            <span key={key} className="flex items-center gap-1.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium leading-[normal] text-[#52525b]">
              {label}
              <Skeleton className="h-4 w-5 rounded-full" />
            </span>
          ))}
        </div>
        <div className={COLUMNS_FRAME}>
          {BOARD_COLUMNS.map(({ key, label }) => (
            <section key={key} aria-label={label} className={COLUMN_FRAME}>
              <h2 className="px-1 pb-2 text-[13px] font-semibold text-[#1f1a2e]">{label}</h2>
              <ul className="space-y-2.5">
                {Array.from({ length: 2 }, (_, i) => (
                  <li key={i} className="flex flex-col gap-1.5 rounded-xl border border-[#e6e1ee] bg-white p-3.5">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-8 w-full rounded-lg" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <MoveRules />
      </div>
    </div>
  );
}
