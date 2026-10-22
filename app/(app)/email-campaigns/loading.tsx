import { Skeleton } from "@/components/ui/skeleton";
import { COLUMNS } from "@/features/marketing/campaign-list";

/** Static chrome renders as-is; only the data (subscriber counts and Announcements) is skeleton. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading Email Campaigns"
      className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7"
    >
      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Email Campaigns</h1>
          <p className="text-sm leading-[normal] text-[#6e6680]">Every Announcement goes to every Subscriber.</p>
        </div>
        <span className="shrink-0 rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-white">
          New campaign
        </span>
      </div>

      <div className="flex w-full min-w-0 flex-col gap-[6px] rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal] sm:w-64">
        <p className="text-[13px] font-medium text-[#6e6680]">Subscribers</p>
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-4 w-28" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[14px] rounded-xl border border-[#e6e1ee] bg-white p-5">
        <h2 className="shrink-0 text-base font-semibold leading-[normal] text-[#1f1a2e]">Announcements</h2>
        <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
          <div className="flex min-h-0 min-w-[560px] flex-1 flex-col">
            <div className={`grid shrink-0 ${COLUMNS} items-center gap-4 border-b border-[#efebf4] py-1.5 text-xs font-medium text-[#6e6680]`}>
              <span>Announcement</span>
              <span>Sent to</span>
              <span>Sent date</span>
              <span>Status</span>
            </div>
            <ul className="min-h-0 flex-1 overflow-hidden">
              {Array.from({ length: 8 }, (_, i) => (
                <li key={i} className={`grid ${COLUMNS} items-center gap-4 border-b border-[#efebf4] py-[11px]`}>
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
