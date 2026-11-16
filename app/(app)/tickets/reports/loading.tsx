import { TICKET_REPORT_LABELS, TICKET_REPORT_PRESETS } from "@/features/reports/ticket-report";
import { TicketReportSkeleton } from "@/features/reports/ticket-report-view";

/** Static chrome renders as-is; only the figures are skeleton. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-8">
      <p className="text-[13px] font-medium text-[#71717a]">Tickets <span className="text-[#18181b]">/ Reports</span></p>
      <h1 className="text-2xl font-semibold leading-[normal] text-[#18181b]">Ticket reports</h1>
      <div className="flex flex-wrap gap-2" aria-hidden>
        {TICKET_REPORT_PRESETS.map((p) => (
          <span key={p} className="rounded-lg border border-[#e4e4e7] bg-white px-3 py-2 text-sm font-medium text-[#18181b]">{TICKET_REPORT_LABELS[p]}</span>
        ))}
      </div>
      <TicketReportSkeleton />
    </div>
  );
}
