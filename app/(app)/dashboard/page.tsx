import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadDashboardFigures, type Widget } from "@/features/dashboard/figures";
import { PERIOD_LABELS, PERIOD_PRESETS, resolvePeriod } from "@/features/dashboard/period";
import { DASHBOARD_MODULE, ORDERS_MODULE, PAYMENTS_MODULE } from "@/lib/portal/config";
import { heldModules, requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const pesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

function Stat({ title, widget, format }: { title: string; widget: Widget; format: (n: number) => string }) {
  return (
    <section className="rounded-xl border border-[#e6e1ee] bg-white p-5 leading-[normal]">
      <h2 className="text-sm font-medium text-[#6e6680]">{title}</h2>
      {widget.ok ? (
        <>
          <p className="mt-1 text-2xl font-semibold text-[#1f1a2e]">{format(widget.current)}</p>
          <p className="mt-1 text-xs text-[#6e6680]">Previous period: {format(widget.previous)}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-[#6e6680]">Temporarily unavailable. Reload to try again.</p>
      )}
    </section>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  await requireModule(DASHBOARD_MODULE);

  const raw = (await searchParams).period;
  const preset = PERIOD_PRESETS.find((p) => p === (Array.isArray(raw) ? raw[0] : raw)) ?? "7-days";
  const period = resolvePeriod(preset, new Date());
  const modules = await heldModules([ORDERS_MODULE, PAYMENTS_MODULE]);
  const figures = await loadDashboardFigures(ticketsDatabase, { period, modules });

  return (
    <div className="flex flex-col gap-5 px-4 py-7 sm:px-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Dashboard</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">Figures are in Philippine Time.</p>
      </div>
      <nav aria-label="Period" className="flex flex-wrap gap-2">
        {PERIOD_PRESETS.map((p) => (
          <Link
            key={p}
            href={`/dashboard?period=${p}`}
            aria-current={p === preset ? "true" : undefined}
            className="rounded-full border border-[#e6e1ee] px-3 py-1 text-sm aria-[current=true]:bg-[#1f1a2e] aria-[current=true]:text-white"
          >
            {PERIOD_LABELS[p]}
          </Link>
        ))}
      </nav>
      {figures.sales || figures.orders ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {figures.sales && <Stat title="Sales" widget={figures.sales} format={(n) => pesos.format(n / 100)} />}
          {figures.orders && <Stat title="Orders" widget={figures.orders} format={String} />}
        </div>
      ) : (
        <Alert>
          <AlertTitle>Nothing to show yet</AlertTitle>
          <AlertDescription>Your Modules do not include any data the Dashboard summarises.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
