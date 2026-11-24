import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AreaMap, AreaMapSkeleton } from "@/features/ai-insights/area-map";
import { areaInsightsIn } from "@/features/ai-insights/areas";
import { cachedAnalytics } from "@/features/dashboard/breakdowns";
import { PeriodNavigation, PeriodPicker } from "@/features/dashboard/period-navigation";
import { PERIOD_PRESETS, resolvePeriod, type Period } from "@/features/dashboard/period";
import { UnusualActivityCards } from "@/features/dashboard/unusual-activity-cards";
import { DASHBOARD_MODULE, ORDERS_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";
import { canSeeAiInsights, heldModules, requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const AI_INSIGHTS_PATH = "/dashboard/ai-insights";

/** Its own boundary, so the page shell and the Unusual activity never wait on the map's figures. */
async function AreaMapSection({ period }: { period: Period }) {
  const sql = ticketsDatabase();
  const insights = await cachedAnalytics(sql, `areas:${period.start.toISOString()}:${period.end.toISOString()}`,
    () => areaInsightsIn(sql, period)).catch(() => null);
  if (!insights) {
    return (
      <section aria-label="Where our Orders go" className="rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]">
        <h2 className="text-[13px] font-medium text-[#71717a]">Where our Orders go</h2>
        <p className="mt-2 text-sm text-[#71717a]">Couldn&apos;t load the map. Reload the page to try again.</p>
      </section>
    );
  }
  return <AreaMap insights={insights} />;
}

/** AI Insights: where Orders go, and the Unusual activity the AI spotted. Managers dismiss; Admin views; Staff go back to the Summary. */
export default async function AiInsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireModule(DASHBOARD_MODULE);
  if (!canSeeAiInsights(staff.role)) redirect("/dashboard");
  const canDismiss = shopRole(staff.role) === "manager";

  const raw = (await searchParams).period;
  const preset = PERIOD_PRESETS.find((p) => p === (Array.isArray(raw) ? raw[0] : raw)) ?? "7-days";
  const period = resolvePeriod(preset, new Date());
  const showMap = (await heldModules([ORDERS_MODULE])).includes(ORDERS_MODULE);

  return (
    <PeriodNavigation preset={preset} basePath={AI_INSIGHTS_PATH}>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-7 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 space-y-1 leading-[normal]">
            <h1 className="text-2xl font-semibold text-[#18181b]">AI Insights</h1>
            <p className="text-sm text-[#71717a]">Where Orders go, and unusual activity the AI spotted, for a person to check</p>
          </div>
          <PeriodPicker exportable={false} />
        </div>
        <UnusualActivityCards
          canDismiss={canDismiss}
          emptyState={
            <section aria-label="Unusual activity" className="rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]">
              <h2 className="text-[13px] font-medium text-[#71717a]">Unusual activity</h2>
              <p className="mt-2 text-sm text-[#71717a]">No unusual activity right now.</p>
            </section>
          }
        />
        {showMap && (
          <Suspense key={preset} fallback={<AreaMapSkeleton />}>
            <AreaMapSection period={period} />
          </Suspense>
        )}
      </div>
    </PeriodNavigation>
  );
}
