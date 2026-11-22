import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PeriodNavigation, PeriodPicker } from "@/features/dashboard/period-navigation";
import {
  TICKET_REPORT_LABELS, TICKET_REPORT_PRESETS, loadTicketReport, mayReadTicketReport, parseReportPreset, resolveReportPeriod,
} from "@/features/reports/ticket-report";
import { TicketReportView } from "@/features/reports/ticket-report-view";
import { crmsDatabase } from "@/lib/crms-db";
import { NO_ACCESS_PATH, REPORTS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Access: CREOMS Manager (CEO and VP included), Admin (view). Staff are sent to the no-access page. */
export default async function TicketReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireModule(REPORTS_MODULE);
  if (!mayReadTicketReport(staff.role)) redirect(NO_ACCESS_PATH);

  const preset = parseReportPreset((await searchParams).period);
  const result = await loadTicketReport(
    { tickets: ticketsDatabase(), crms: crmsDatabase() },
    { role: staff.role, period: resolveReportPeriod(preset, new Date()) },
  );

  return (
    <PeriodNavigation preset={preset} basePath="/tickets/reports">
      <div className="flex flex-col gap-4 px-4 py-5 sm:px-8">
        <p className="text-[13px] font-medium text-[#71717a]">
          <Link href="/tickets">Tickets</Link> <span className="text-[#18181b]">/ Reports</span>
        </p>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#18181b]">Ticket reports</h1>
          <p className="text-sm leading-[normal] text-[#71717a]">How Tickets are handled: speed, the Service level, ratings and who carries the load.</p>
        </div>
        <PeriodPicker exportable={false} presets={TICKET_REPORT_PRESETS} labels={TICKET_REPORT_LABELS} />
        {result.ok ? (
          <TicketReportView report={result.report} />
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Ticket reports are temporarily unavailable</AlertTitle>
            <AlertDescription>CREOMS could not read the Tickets. Reload to try again.</AlertDescription>
          </Alert>
        )}
      </div>
    </PeriodNavigation>
  );
}
