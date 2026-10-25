import Link from "next/link";
import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CustomersByStageCard, CustomersByStageSkeleton, NewCustomersCard, NewCustomersSkeleton } from "@/features/dashboard/customer-cards";
import { DashboardExportButton } from "@/features/dashboard/export-button";
import { hasAttentionQueue, type Attention } from "@/features/dashboard/attention";
import { NeedsAttention, NeedsAttentionFailed, NeedsAttentionSkeleton } from "@/features/dashboard/needs-attention";
import { loadDashboardFigures, visibleWidgets, type DashboardWidgets } from "@/features/dashboard/figures";
import { PERIOD_LABELS, PERIOD_PRESETS, resolvePeriod } from "@/features/dashboard/period";
import { SalesChart, SalesChartSkeleton } from "@/features/dashboard/sales-chart";
import { BuyersTile, RatingTile, StatTile, StatTileSkeleton } from "@/features/dashboard/stat-tile";
import { DASHBOARD_DATA_MODULES, DASHBOARD_MODULE } from "@/lib/portal/config";
import { heldModules, requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const pesos = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

type FigureProps = { figures: Promise<DashboardWidgets> };

/** Each widget awaits its own result from the same cached generation as the PDF. */
async function SalesTile({ figures }: FigureProps) {
  const widget = await (await figures).sales;
  if (!widget) return null;

  return <StatTile title="Sales" widget={widget} format={(centavos) => pesos.format(centavos / 100)} />;
}

async function OrdersTile({ figures }: FigureProps) {
  const widget = await (await figures).orders;
  if (!widget) return null;

  return <StatTile title="Orders" widget={widget} format={String} />;
}

async function AverageOrderTile({ figures }: FigureProps) {
  const widget = await (await figures).averageOrder;
  if (!widget) return null;

  return <StatTile title="Average order" widget={widget} format={(centavos) => pesos.format(centavos / 100)} />;
}

async function ReturningBuyersTile({ figures }: FigureProps) {
  const widget = await (await figures).returningBuyers;
  return widget ? <BuyersTile widget={widget} /> : null;
}

async function AverageRatingTile({ figures }: FigureProps) {
  const widget = await (await figures).averageRating;
  return widget ? <RatingTile widget={widget} /> : null;
}

async function MonthlySalesChart({ figures }: FigureProps) {
  const widget = await (await figures).monthlySales;
  if (!widget) return null;

  return <SalesChart widget={widget} format={(centavos) => pesos.format(centavos / 100)} />;
}

async function CustomersByStage({ figures }: FigureProps) {
  const widget = await (await figures).customersByStage;
  return widget ? <CustomersByStageCard widget={widget} /> : null;
}

async function NewCustomers({ figures, periodLabel }: FigureProps & { periodLabel: string }) {
  const widgets = await figures;
  const [widget, leads] = await Promise.all([widgets.newCustomers, widgets.unverifiedLeads]);
  return widget && leads ? <NewCustomersCard widget={widget} leads={leads} periodLabel={periodLabel} /> : null;
}

/** Always live, and on its own boundary so the queue never waits on the analytics. */
async function NeedsAttentionCard({ figures, now }: FigureProps & { now: Date }) {
  let attention: Attention | undefined;
  try {
    attention = await (await figures).attention;
  } catch {
    return <NeedsAttentionFailed />;
  }
  return attention ? <NeedsAttention attention={attention} now={now} /> : null;
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  await requireModule(DASHBOARD_MODULE);

  const raw = (await searchParams).period;
  const preset = PERIOD_PRESETS.find((p) => p === (Array.isArray(raw) ? raw[0] : raw)) ?? "7-days";
  const now = new Date();
  const period = resolvePeriod(preset, now);
  const modules = await heldModules(DASHBOARD_DATA_MODULES);
  const figures = loadDashboardFigures(ticketsDatabase, { period, modules, now, stream: true });
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
        <DashboardExportButton period={preset} />
      </div>
      {Object.values(show).some(Boolean) || attention ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {show.sales && (
              <Suspense fallback={<StatTileSkeleton title="Sales" />}>
                <SalesTile figures={figures} />
              </Suspense>
            )}
            {show.orders && (
              <Suspense fallback={<StatTileSkeleton title="Orders" />}>
                <OrdersTile figures={figures} />
              </Suspense>
            )}
            {show.averageOrder && (
              <Suspense fallback={<StatTileSkeleton title="Average order" />}>
                <AverageOrderTile figures={figures} />
              </Suspense>
            )}
            {show.returningBuyers && (
              <Suspense fallback={<StatTileSkeleton title="Returning Buyers" />}>
                <ReturningBuyersTile figures={figures} />
              </Suspense>
            )}
            {show.averageRating && (
              <Suspense fallback={<StatTileSkeleton title="Average rating" />}>
                <AverageRatingTile figures={figures} />
              </Suspense>
            )}
          </div>
          {show.monthlySales && (
            <Suspense fallback={<SalesChartSkeleton />}>
              <MonthlySalesChart figures={figures} />
            </Suspense>
          )}
          {show.customers && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
              <Suspense fallback={<CustomersByStageSkeleton />}>
                <CustomersByStage figures={figures} />
              </Suspense>
              <Suspense key={preset} fallback={<NewCustomersSkeleton periodLabel={PERIOD_LABELS[preset]} />}>
                <NewCustomers figures={figures} periodLabel={PERIOD_LABELS[preset]} />
              </Suspense>
            </div>
          )}
          {attention && (
            <Suspense fallback={<NeedsAttentionSkeleton />}>
              <NeedsAttentionCard figures={figures} now={now} />
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
