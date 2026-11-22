import { CLICKABLE_ROW, RowLink } from "@/components/shared/row-link";
import { Skeleton } from "@/components/ui/skeleton";
import { ticketsHref } from "@/features/tickets/ticket-params";
import { describeTarget } from "@/features/tickets/service-level";

import type { TicketReport } from "./ticket-report";

const CARD =
  "flex min-w-0 flex-col items-start gap-1 rounded-xl border border-[#e6e1ee] bg-white px-[18px] py-4 leading-[normal]";
const PANEL = "flex min-w-0 flex-col gap-3 rounded-xl border border-[#e6e1ee] bg-white px-[18px] py-4";
const TILE_TITLES = [
  "First reply (median)", "Resolve (median)", "Met the Service level", "Reopen rate", "Average rating", "Escalated",
];

/** Working time, never wall-clock: "3h 20m", "2d 4h"; a dash when nothing happened in the period. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.round(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;

  return `${minutes}m`;
}

export const formatShare = (rate: number | null) => (rate === null ? "—" : `${(rate * 100).toFixed(1)}%`);
export const formatStars = (rating: number | null) => (rating === null ? "—" : `${rating.toFixed(1)} / 5`);

function Tile({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <section className={CARD}>
      <h2 className="text-[13px] font-medium text-[#71717a]">{title}</h2>
      <p className="text-2xl font-semibold text-[#18181b]">{value}</p>
      <p className="text-xs text-[#71717a]">{note}</p>
    </section>
  );
}

const Empty = ({ children }: { children: string }) => <p className="text-sm text-[#71717a]">{children}</p>;

export function TicketReportView({ report }: { report: TicketReport }) {
  const maxCategory = Math.max(1, ...report.categories.map((c) => c.count));

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tile title={TILE_TITLES[0]} value={formatDuration(report.firstReplyMedian)} note={`Target ${describeTarget(report.targets.firstReplyHours)}; Tickets opened in the period`} />
        <Tile title={TILE_TITLES[1]} value={formatDuration(report.resolveMedian)} note={`Target ${describeTarget(report.targets.resolveHours)}; Tickets marked Resolved in the period`} />
        <Tile title={TILE_TITLES[2]} value={formatShare(report.metShare)} note={`Of ${report.judged} Tickets opened in the period that are settled`} />
        <Tile title={TILE_TITLES[3]} value={formatShare(report.reopenRate)} note={`${report.reopened} of ${report.resolvedCount} Resolved came back (reopened or Follow-up)`} />
        <Tile title={TILE_TITLES[4]} value={formatStars(report.averageRating)} note={`From ${report.rated} rated Tickets`} />
        <Tile title={TILE_TITLES[5]} value={String(report.escalated)} note="Escalations raised in the period" />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <section className={PANEL} aria-labelledby="by-category">
          <h2 id="by-category" className="text-base font-semibold text-[#18181b]">Tickets by Category</h2>
          {report.categories.length === 0 ? <Empty>No Tickets were opened in this period.</Empty> : (
            <ul className="flex flex-col gap-2">
              {report.categories.map((c) => (
                <li key={c.category} className={`${CLICKABLE_ROW} flex items-center gap-3 rounded text-sm`}>
                  <RowLink href={ticketsHref({ tab: "all", page: 1, category: c.category })} prefetch className="w-40 shrink-0 truncate text-[#18181b]">{c.category}</RowLink>
                  <span className="h-2 flex-1 rounded bg-[#f1eef6]" aria-hidden>
                    <span className="block h-2 rounded bg-[#5b2a86]" style={{ width: `${(c.count / maxCategory) * 100}%` }} />
                  </span>
                  <span className="w-8 shrink-0 text-right font-medium text-[#18181b]">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={PANEL} aria-labelledby="by-staff">
          <h2 id="by-staff" className="text-base font-semibold text-[#18181b]">By Staff member</h2>
          {report.staff.length === 0 ? <Empty>No Staff member holds or resolved a Ticket.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-[#71717a]">
                  <tr><th className="py-1 font-medium">Staff member</th><th className="py-1 text-right font-medium">Open now</th><th className="py-1 text-right font-medium">Resolved</th><th className="py-1 text-right font-medium">Avg rating</th></tr>
                </thead>
                <tbody>
                  {report.staff.map((s) => (
                    <tr key={s.id} className={`${CLICKABLE_ROW} border-t border-[#f1eef6]`}>
                      <td className="py-2 text-[#18181b]"><RowLink href={ticketsHref({ tab: "all", page: 1, claimedBy: s.id })} prefetch>{s.name}</RowLink></td>
                      <td className="py-2 text-right">{s.open}</td>
                      <td className="py-2 text-right">{s.resolved}</td>
                      <td className="py-2 text-right">{formatStars(s.averageRating)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className={PANEL} aria-labelledby="lowest">
        <h2 id="lowest" className="text-base font-semibold text-[#18181b]">Lowest ratings</h2>
        {report.lowest.length === 0 ? <Empty>No Ticket was rated in this period.</Empty> : (
          <ul className="flex flex-col divide-y divide-[#f1eef6]">
            {report.lowest.map((r) => (
              <li key={r.ticketId} className={`${CLICKABLE_ROW} flex flex-col gap-1 py-2 text-sm`}>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-[#18181b]">{r.rating} / 5</span>
                  <RowLink href={`/tickets/${r.ticketId}`} prefetch className="font-medium text-[#5b2a86] underline-offset-2 hover:underline">TKT-{r.ticketId}</RowLink>
                  <span className="text-[#52525b]">{r.subject}</span>
                  <span className="text-xs text-[#71717a]">{r.customerName}</span>
                </p>
                <p className="text-[#18181b]">{r.comment ? r.comment : <span className="text-[#71717a]">No comment.</span>}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="rounded-[10px] bg-[#f1f1f3] p-3 text-xs text-[#52525b]">
        Times count working hours only: time On hold and time waiting on the Customer is left out, and an Internal note is
        never a reply. A missed target stays missed. Periods are whole days in Philippine Time.
      </p>
    </>
  );
}

export function TicketReportSkeleton() {
  return (
    <div role="status" aria-label="Loading Ticket reports" className="flex flex-col gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {TILE_TITLES.map((title) => (
          <section key={title} className={CARD}>
            <h2 className="text-[13px] font-medium text-[#71717a]">{title}</h2>
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-40" />
          </section>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}
