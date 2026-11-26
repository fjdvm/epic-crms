import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AreaSection, AreaSectionSkeleton } from "@/features/ai-insights/area-map";
import { InsightGrid, InsightGridSkeleton } from "@/features/ai-insights/insight-grid";
import { AI_INSIGHTS_MODULES, emptyStats, type PeriodDays } from "@/features/ai-insights/insights";
import { loadLatestRun } from "@/features/ai-insights/run";
import { Brief, HowThisWorks, StatRow, StatRowSkeleton } from "@/features/ai-insights/sections";
import { viewerState, visibleInsights } from "@/features/ai-insights/store";
import { updatedLabel, visibleStats } from "@/features/ai-insights/view-model";
import { DashboardExportButton } from "@/features/dashboard/export-button";
import { PeriodNavigation, PeriodPicker } from "@/features/dashboard/period-navigation";
import { UnusualActivityCards } from "@/features/dashboard/unusual-activity-cards";
import { crmsDatabase } from "@/lib/crms-db";
import { DASHBOARD_MODULE, FEEDBACK_MODULE, ORDERS_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";
import { canSeeAiInsights, heldModules, requireModule } from "@/lib/portal/staff";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Staff = Awaited<ReturnType<typeof requireModule>>;

const AI_INSIGHTS_PATH = "/dashboard/ai-insights";
const PRESETS = ["7-days", "30-days"] as const;
const LABELS = { "7-days": "Last 7 days", "30-days": "Last 30 days" };

function Unavailable() {
  return (
    <section className="rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 text-sm text-[#71717a]">
      Couldn&apos;t load AI insights. Reload the page to try again.
    </section>
  );
}

/** Reads the stored morning run, and this person's dismissals and answers. Never works anything out and never calls a model. */
async function Body({ staff, days }: { staff: Staff; days: PeriodDays }) {
  const crms = crmsDatabase();
  const [run, modules] = await Promise.all([loadLatestRun(crms, days).catch(() => undefined), heldModules(AI_INSIGHTS_MODULES)]);
  if (run === undefined) return <Unavailable />;
  const now = new Date();

  if (!run) {
    const empty = emptyStats();
    return (
      <>
        <Brief days={days} summary={null} confidence={null} enoughData={false} orders={0} stats={empty} waiting />
        <StatRow stats={empty} />
        {modules.includes(ORDERS_MODULE) && <AreaSection areas={[]} unmapped={0} orders={0} days={days} enoughData={false} />}
        <InsightGrid initial={[]} days={days} answers={{}} enoughData={false} waiting />
      </>
    );
  }

  const state = await viewerState(crms, staff, run).catch(() => ({ dismissed: new Map(), answers: {} }));
  const stats = visibleStats(run.stats, modules);
  return (
    <>
      <p className="-mt-3 text-xs text-[#a1a1aa]">{updatedLabel(run.createdAt, now)} · refreshes each morning at 6:00 am</p>
      <Brief days={days} summary={run.summary} confidence={run.summaryConfidence} enoughData={run.enoughData} orders={run.orders} stats={stats} />
      <StatRow stats={stats} />
      {modules.includes(ORDERS_MODULE) && (
        <AreaSection areas={run.areas} unmapped={run.unmapped} orders={run.orders} days={days} enoughData={run.enoughData}
          products={run.products} canSeeRatings={modules.includes(FEEDBACK_MODULE)} />
      )}
      <InsightGrid key={`${run.id}`} initial={visibleInsights(run.insights, modules, state.dismissed)} days={days}
        answers={state.answers} enoughData={run.enoughData} />
    </>
  );
}

/**
 * AI insights: what changed this week, where, and what to look at next. Manager-level Roles (CREOMS Manager, General
 * Manager, CEO, VP) and Admin open it; Staff go back to the Summary. Suggestions only: nothing here changes the shop.
 */
export default async function AiInsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireModule(DASHBOARD_MODULE);
  if (!canSeeAiInsights(staff.role)) redirect("/dashboard");
  const readOnly = shopRole(staff.role) === "admin";

  const raw = (await searchParams).period;
  const preset = PRESETS.find((p) => p === (Array.isArray(raw) ? raw[0] : raw)) ?? "7-days";
  const days: PeriodDays = preset === "30-days" ? 30 : 7;

  return (
    <PeriodNavigation preset={preset} basePath={AI_INSIGHTS_PATH}>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-7 sm:px-8">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1 leading-[normal]">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-[#18181b]">AI insights</h1>
              <span className="rounded-full bg-[#f5f0fa] px-2 py-0.5 text-xs font-medium text-[#5b2a86]">✦ Suggestions only</span>
              {readOnly && <span className="rounded-full border border-[#e4e4e7] bg-white px-2 py-0.5 text-xs font-medium text-[#52525b]">Read-only</span>}
            </div>
            <p className="text-sm text-[#71717a]">
              What changed, where, and what to look at next. The AI only suggests. Nothing here changes an order, stock or a customer.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <PeriodPicker exportable={false} presets={PRESETS} labels={LABELS} />
            <DashboardExportButton period="7-days" endpoint={`/api/dashboard/ai-insights/pdf?days=${days}`} filename={`ai-insights-${days}-days.pdf`} label="Export PDF" />
          </div>
        </div>
        <Suspense key={preset} fallback={<><StatRowSkeleton /><AreaSectionSkeleton /><InsightGridSkeleton /></>}>
          <Body staff={staff} days={days} />
        </Suspense>
        <UnusualActivityCards
          canDismiss={shopRole(staff.role) === "manager"}
          emptyState={
            <section aria-label="Unusual activity" className="rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]">
              <h2 className="text-[13px] font-medium text-[#71717a]">Unusual activity</h2>
              <p className="mt-2 text-sm text-[#71717a]">No unusual activity right now.</p>
            </section>
          }
        />
        <HowThisWorks />
      </div>
    </PeriodNavigation>
  );
}
