import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PERIOD_PRESETS, resolvePeriod } from "@/features/dashboard/period";
import { PeriodNavigation, PeriodPicker } from "@/features/dashboard/period-navigation";
import { loadFulfilmentReport, mayReadFulfilmentReport } from "@/features/reports/fulfilment-report";
import { FulfilmentReportView } from "@/features/reports/fulfilment-report-view";
import { FULFILMENT_MODULE, NO_ACCESS_PATH } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Access: CREOMS Manager, Admin (view), CEO (view). Staff are sent to the no-access page. */
export default async function FulfilmentReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireModule(FULFILMENT_MODULE);
  if (!mayReadFulfilmentReport(staff.role)) redirect(NO_ACCESS_PATH);

  const raw = (await searchParams).period;
  const preset = PERIOD_PRESETS.find((p) => p === (Array.isArray(raw) ? raw[0] : raw)) ?? "7-days";
  const result = await loadFulfilmentReport(ticketsDatabase, { role: staff.role, period: resolvePeriod(preset, new Date()) });

  return (
    <PeriodNavigation preset={preset} basePath="/fulfilment/reports">
      <div className="flex flex-col gap-4 px-4 py-5 sm:px-8">
        <p className="text-[13px] font-medium text-[#71717a]">
          <Link href="/fulfilment">Fulfilment</Link> <span className="text-[#18181b]">/ Reports</span>
        </p>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#18181b]">Fulfilment reports</h1>
          <p className="text-sm leading-[normal] text-[#71717a]">How fast and how reliably Orders reach Customers.</p>
        </div>
        <PeriodPicker exportable={false} />
        {result.ok ? (
          <FulfilmentReportView figures={result.figures} />
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Fulfilment reports are temporarily unavailable</AlertTitle>
            <AlertDescription>CREOMS could not read the store&apos;s Orders. Reload to try again.</AlertDescription>
          </Alert>
        )}
      </div>
    </PeriodNavigation>
  );
}
