import Link from "next/link";

import { formatDate } from "@/features/customer-profiles/format";

import { formatPhilippineTime } from "./philippine-time";
import type { AnnouncementRow, AnnouncementState } from "./announcements";

const STATUS: Record<AnnouncementState, { label: string; pill: string }> = {
  draft: { label: "Draft", pill: "bg-[#eeecf2] text-[#5a5368]" },
  scheduled: { label: "Scheduled", pill: "bg-[#e3eefb] text-[#1d4f91]" },
  sent: { label: "Sent", pill: "bg-[#e3f4e8] text-[#1e6b3a]" },
  failed: { label: "Failed", pill: "bg-[#fde8e8] text-[#9b1c1c]" },
};

export function StatusPill({ state }: { state: AnnouncementState }) {
  const { label, pill } = STATUS[state];

  return <span className={`rounded-full px-[10px] py-[3px] text-xs font-medium leading-[normal] whitespace-nowrap ${pill}`}>{label}</span>;
}

export const COLUMNS = "grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]";

/** The Subscribers card: verified Customers who said yes to marketing, out of every Customer. */
export function SubscribersCard({ counts }: { counts: { subscribers: number; customers: number } | null }) {
  return (
    <div
      data-testid="subscribers"
      className="flex w-full min-w-0 flex-col gap-[6px] rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal] sm:w-64"
    >
      <p className="text-[13px] font-medium text-[#6e6680]">Subscribers</p>
      <p className="text-2xl font-semibold text-[#1f1a2e]">{counts ? counts.subscribers : "–"}</p>
      <p className="text-xs text-[#6e6680]">{counts ? `Of ${counts.customers} customers` : "Could not be counted right now"}</p>
    </div>
  );
}

/** The Announcements table. A Draft or Scheduled Announcement opens to be edited; the rest open read-only. */
export function CampaignList({ announcements }: { announcements: AnnouncementRow[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[14px] rounded-xl border border-[#e6e1ee] bg-white p-5">
      <h2 className="shrink-0 text-base font-semibold leading-[normal] text-[#1f1a2e]">Announcements</h2>
      {announcements.length === 0 ? (
        <p className="p-8 text-center text-sm text-[#6e6680]">No Announcements yet. Start one with New campaign.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
          <div className="flex min-h-0 min-w-[560px] flex-1 flex-col">
            <div className={`grid shrink-0 ${COLUMNS} items-center gap-4 border-b border-[#efebf4] py-1.5 text-xs font-medium text-[#6e6680]`}>
              <span>Announcement</span>
              <span>Sent to</span>
              <span>Sent date</span>
              <span>Status</span>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {announcements.map((a) => (
                <li key={a.id} className={`grid ${COLUMNS} items-center gap-4 border-b border-[#efebf4] py-[11px] text-sm leading-[normal] text-[#1f1a2e]`}>
                  <Link href={`/email-campaigns/${a.id}`} className="truncate font-medium text-[#5b2a86] hover:underline">
                    {a.title}
                  </Link>
                  <span>{a.sentTo ?? "—"}</span>
                  <span>
                    {a.sentAt
                      ? formatDate(a.sentAt)
                      : a.state === "scheduled" && a.scheduledFor
                        ? `${formatPhilippineTime(a.scheduledFor)} PHT`
                        : "—"}
                  </span>
                  <span>
                    <StatusPill state={a.state} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
