import Link from "next/link";
import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadWidget, ordersIn, salesIn, visibleWidgets } from "@/features/dashboard/figures";
import { PERIOD_LABELS, PERIOD_PRESETS, resolvePeriod, type Period } from "@/features/dashboard/period";
import { StatTile, StatTileSkeleton } from "@/features/dashboard/stat-tile";
import { DASHBOARD_MODULE, ORDERS_MODULE, PAYMENTS_MODULE } from "@/lib/portal/config";
import { heldModules, requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const pesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

/** Each widget loads on its own, so a slow or failing one never holds back the others. */
async function SalesTile({ period }: { period: Period }) {
  const widget = await loadWidget(() => ticketsDatabase(), period, salesIn);

  return <StatTile title="Sales" widget={widget} format={(centavos) => pesos.format(centavos / 100)} />;
}

async function OrdersTile({ period }: { period: Period }) {
  const widget = await loadWidget(() => ticketsDatabase(), period, ordersIn);

  return <StatTile title="Orders" widget={widget} format={String} />;
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  await requireModule(DASHBOARD_MODULE);

  const raw = (await searchParams).period;
  const preset = PERIOD_PRESETS.find((p) => p === (Array.isArray(raw) ? raw[0] : raw)) ?? "7-days";
  const period = resolvePeriod(preset, new Date());
  const modules = await heldModules([ORDERS_MODULE, PAYMENTS_MODULE]);
  const { sales: showSales, orders: showOrders } = visibleWidgets(modules);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-7 sm:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1 leading-[normal]">
          <h1 className="text-2xl font-semibold text-[#18181b]">Dashboard</h1>
          <p className="text-sm text-[#71717a]">How the business is doing, at a glance</p>
        </div>
        <nav aria-label="Period" className="flex flex-wrap gap-2">
          {PERIOD_PRESETS.map((p) => (
            <Link
              key={p}
              href={`/dashboard?period=${p}`}
              aria-current={p === preset ? "true" : undefined}
              className="rounded-lg border border-[#e4e4e7] bg-white px-3 py-2 text-sm font-medium text-[#18181b] aria-[current=true]:border-[#5b2a86] aria-[current=true]:bg-[#5b2a86] aria-[current=true]:text-white"
            >
              {PERIOD_LABELS[p]}
            </Link>
          ))}
        </nav>
      </div>
      {showSales || showOrders ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {showSales && (
            <Suspense fallback={<StatTileSkeleton title="Sales" />}>
              <SalesTile period={period} />
            </Suspense>
          )}
          {showOrders && (
            <Suspense fallback={<StatTileSkeleton title="Orders" />}>
              <OrdersTile period={period} />
            </Suspense>
          )}
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
