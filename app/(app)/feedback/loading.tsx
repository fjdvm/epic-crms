import { Skeleton } from "@/components/ui/skeleton";

const SUMMARY_LABELS = ["Average rating", "Low ratings", "Response rate", "Top product"];

/** Static chrome renders as-is; only the data (summary figures, filters and Feedback rows) is skeleton. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading Feedback"
      className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7"
    >
      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Feedback</h1>
          <p className="text-sm leading-[normal] text-[#6e6680]">Every Feedback is tied to a delivered Order.</p>
        </div>
        <Skeleton className="h-9 w-24 shrink-0" />
        <Skeleton className="h-9 w-40 shrink-0" />
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-4 lg:grid-cols-4">
        {SUMMARY_LABELS.map((label) => (
          <div
            key={label}
            className="flex min-w-0 flex-col gap-[6px] rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]"
          >
            <p className="text-[13px] font-medium text-[#6e6680]">{label}</p>
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-xl border border-[#e6e1ee] bg-white p-5">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <h2 className="text-base font-semibold leading-[normal] text-[#1f1a2e]">Latest feedback</h2>
          <div className="flex shrink-0 items-center gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex flex-col gap-2 border-b border-[#efebf4] py-3">
              <div className="flex items-center gap-[10px]">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 min-w-0 flex-1" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-4 w-2/3" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
