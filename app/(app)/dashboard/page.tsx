import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  BestSellersCard, BestSellersSkeleton, BuyersCard, BuyersSkeleton, PaymentCard, PaymentSkeleton,
} from "@/features/dashboard/breakdown-cards";
import { PeriodNavigation, PeriodPicker, WhilePending } from "@/features/dashboard/period-navigation";
import { hasAttentionQueue, type Attention } from "@/features/dashboard/attention";
import { NeedsAttention, NeedsAttentionFailed, NeedsAttentionSkeleton } from "@/features/dashboard/needs-attention";
import { loadDashboardFigures, visibleWidgets, type DashboardWidgets } from "@/features/dashboard/figures";
import { PERIOD_PRESETS, resolvePeriod } from "@/features/dashboard/period";
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

async function BestSellersSection({ figures }: FigureProps) {
  const widget = await (await figures).bestSellers;
  if (!widget) return null;

  return <BestSellersCard widget={widget} format={(centavos) => pesos.format(centavos / 100)} />;
}

async function BuyersSection({ figures }: FigureProps) {
  const widget = await (await figures).monthlyBuyers;
  return widget ? <BuyersCard widget={widget} /> : null;
}

async function PaymentSection({ figures }: FigureProps) {
  const widget = await (await figures).paymentAndReceiving;
  return widget ? <PaymentCard widget={widget} /> : null;
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
    <PeriodNavigation preset={preset}>
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-7 sm:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1 leading-[normal]">
          <h1 className="text-2xl font-semibold text-[#18181b]">Dashboard</h1>
          <p className="text-sm text-[#71717a]">How the business is doing, at a glance</p>
        </div>
        <PeriodPicker />
      </div>
      {Object.values(show).some(Boolean) || attention ? (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {show.sales && (
              <WhilePending fallback={<StatTileSkeleton title="Sales" />}>
                <Suspense fallback={<StatTileSkeleton title="Sales" />}>
                  <SalesTile figures={figures} />
                </Suspense>
              </WhilePending>
            )}
            {show.orders && (
              <WhilePending fallback={<StatTileSkeleton title="Orders" />}>
                <Suspense fallback={<StatTileSkeleton title="Orders" />}>
                  <OrdersTile figures={figures} />
                </Suspense>
              </WhilePending>
            )}
            {show.averageOrder && (
              <WhilePending fallback={<StatTileSkeleton title="Average order" />}>
                <Suspense fallback={<StatTileSkeleton title="Average order" />}>
                  <AverageOrderTile figures={figures} />
                </Suspense>
              </WhilePending>
            )}
            {show.returningBuyers && (
              <WhilePending fallback={<StatTileSkeleton title="Returning Buyers" />}>
                <Suspense fallback={<StatTileSkeleton title="Returning Buyers" />}>
                  <ReturningBuyersTile figures={figures} />
                </Suspense>
              </WhilePending>
            )}
            {show.averageRating && (
              <WhilePending fallback={<StatTileSkeleton title="Average rating" />}>
                <Suspense fallback={<StatTileSkeleton title="Average rating" />}>
                  <AverageRatingTile figures={figures} />
                </Suspense>
              </WhilePending>
            )}
          </div>
          {show.monthlySales && (
            <Suspense fallback={<SalesChartSkeleton />}>
              <MonthlySalesChart figures={figures} />
            </Suspense>
          )}
          {show.breakdowns && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
              <WhilePending fallback={<BestSellersSkeleton />}>
                <Suspense fallback={<BestSellersSkeleton />}>
                  <BestSellersSection figures={figures} />
                </Suspense>
              </WhilePending>
              <Suspense fallback={<BuyersSkeleton />}>
                <BuyersSection figures={figures} />
              </Suspense>
              <WhilePending fallback={<PaymentSkeleton />}>
                <Suspense fallback={<PaymentSkeleton />}>
                  <PaymentSection figures={figures} />
                </Suspense>
              </WhilePending>
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
    </PeriodNavigation>
  );
}
