import Link from "next/link";
import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { hasAttentionQueue, loadAttention } from "@/features/dashboard/attention";
import { NeedsAttention, NeedsAttentionFailed, NeedsAttentionSkeleton } from "@/features/dashboard/needs-attention";
import {
  averageOrderIn,
  averageRatingIn,
  loadMonthlySales,
  loadWidget,
  ordersIn,
  returningBuyersIn,
  salesIn,
  visibleWidgets,
} from "@/features/dashboard/figures";
import { PERIOD_LABELS, PERIOD_PRESETS, resolvePeriod, type Period } from "@/features/dashboard/period";
import { SalesChart, SalesChartSkeleton } from "@/features/dashboard/sales-chart";
import { BuyersTile, RatingTile, StatTile, StatTileSkeleton } from "@/features/dashboard/stat-tile";
import {
  DASHBOARD_MODULE, FEEDBACK_MODULE, FULFILMENT_MODULE, ORDERS_MODULE, PAYMENTS_MODULE, RETURNS_MODULE, TICKETS_MODULE,
} from "@/lib/portal/config";
import { heldModules, requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const pesos = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

/** Each widget loads on its own, so a slow or failing one never holds back the others. */
async function SalesTile({ period }: { period: Period }) {
  const widget = await loadWidget(() => ticketsDatabase(), period, salesIn);

  return <StatTile title="Sales" widget={widget} format={(centavos) => pesos.format(centavos / 100)} />;
}

async function OrdersTile({ period }: { period: Period }) {
  const widget = await loadWidget(() => ticketsDatabase(), period, ordersIn);

  return <StatTile title="Orders" widget={widget} format={String} />;
}

async function AverageOrderTile({ period }: { period: Period }) {
  const widget = await loadWidget(() => ticketsDatabase(), period, averageOrderIn);

  return <StatTile title="Average order" widget={widget} format={(centavos) => pesos.format(centavos / 100)} />;
}

async function ReturningBuyersTile({ period }: { period: Period }) {
  return <BuyersTile widget={await loadWidget(() => ticketsDatabase(), period, returningBuyersIn)} />;
}

async function AverageRatingTile({ period }: { period: Period }) {
  return <RatingTile widget={await loadWidget(() => ticketsDatabase(), period, averageRatingIn)} />;
}

async function MonthlySalesChart() {
  const widget = await loadMonthlySales(() => ticketsDatabase(), new Date());

  return <SalesChart widget={widget} format={(centavos) => pesos.format(centavos / 100)} />;
}

/** Always live, and on its own boundary so the queue never waits on the analytics. */
async function NeedsAttentionCard({ modules }: { modules: readonly string[] }) {
  try {
    const now = new Date();

    return <NeedsAttention attention={await loadAttention(() => ticketsDatabase(), { modules, now })} now={now} />;
  } catch {
    return <NeedsAttentionFailed />;
  }
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  await requireModule(DASHBOARD_MODULE);

  const raw = (await searchParams).period;
  const preset = PERIOD_PRESETS.find((p) => p === (Array.isArray(raw) ? raw[0] : raw)) ?? "7-days";
  const period = resolvePeriod(preset, new Date());
  const modules = await heldModules([
    ORDERS_MODULE, PAYMENTS_MODULE, FEEDBACK_MODULE, FULFILMENT_MODULE, TICKETS_MODULE, RETURNS_MODULE,
  ]);
  const show = visibleWidgets(modules);
  const attention = hasAttentionQueue(modules);

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
      {Object.values(show).some(Boolean) || attention ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {show.sales && (
              <Suspense fallback={<StatTileSkeleton title="Sales" />}>
                <SalesTile period={period} />
              </Suspense>
            )}
            {show.orders && (
              <Suspense fallback={<StatTileSkeleton title="Orders" />}>
                <OrdersTile period={period} />
              </Suspense>
            )}
            {show.averageOrder && (
              <Suspense fallback={<StatTileSkeleton title="Average order" />}>
                <AverageOrderTile period={period} />
              </Suspense>
            )}
            {show.returningBuyers && (
              <Suspense fallback={<StatTileSkeleton title="Returning Buyers" />}>
                <ReturningBuyersTile period={period} />
              </Suspense>
            )}
            {show.averageRating && (
              <Suspense fallback={<StatTileSkeleton title="Average rating" />}>
                <AverageRatingTile period={period} />
              </Suspense>
            )}
          </div>
          {show.monthlySales && (
            <Suspense fallback={<SalesChartSkeleton />}>
              <MonthlySalesChart />
            </Suspense>
          )}
          {attention && (
            <Suspense fallback={<NeedsAttentionSkeleton />}>
              <NeedsAttentionCard modules={modules} />
            </Suspense>
          )}
        </>
      ) : (
        <Alert>
          <AlertTitle>Nothing to show yet</AlertTitle>
          <AlertDescription>Your Modules do not include any data the Dashboard summarises.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
