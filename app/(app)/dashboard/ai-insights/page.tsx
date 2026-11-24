import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AreaMap, AreaMapSkeleton } from "@/features/ai-insights/area-map";
import { InsightTabs } from "@/features/ai-insights/insight-tabs";
import { AI_INSIGHTS_MODULES, loadSections } from "@/features/ai-insights/load";
import {
  CustomersPanel, OperationsPanel, OrdersPanel, PanelSkeleton, PanelUnavailable, PaymentsPanel,
} from "@/features/ai-insights/panels";
import { SuggestionCards, SuggestionsSkeleton, SuggestionsUnavailable } from "@/features/ai-insights/suggestion-cards";
import { loadSuggestions } from "@/features/ai-insights/suggestion-store";
import { PeriodNavigation, PeriodPicker } from "@/features/dashboard/period-navigation";
import { PERIOD_PRESETS, resolvePeriod } from "@/features/dashboard/period";
import { UnusualActivityCards } from "@/features/dashboard/unusual-activity-cards";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import {
  CUSTOMER_PROFILES_MODULE, DASHBOARD_MODULE, FEEDBACK_MODULE, FULFILMENT_MODULE, ORDERS_MODULE, PAYMENTS_MODULE,
  RETURNS_MODULE, TICKETS_MODULE,
} from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";
import { canSeeAiInsights, heldModules, requireModule } from "@/lib/portal/staff";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Sections = ReturnType<typeof loadSections>;
type Staff = Awaited<ReturnType<typeof requireModule>>;

const AI_INSIGHTS_PATH = "/dashboard/ai-insights";

function MapUnavailable() {
  return (
    <section aria-label="Where our Orders go" className="rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]">
      <h2 className="text-[13px] font-medium text-[#71717a]">Where our Orders go</h2>
      <p className="mt-2 text-sm text-[#71717a]">Couldn&apos;t load the map. Reload the page to try again.</p>
    </section>
  );
}

/** Each section awaits its own promise inside its own Suspense boundary, so nothing waits on anything else. */
async function AreaMapSection({ sections }: { sections: Sections }) {
  const insights = await sections.areas;
  return insights ? <AreaMap insights={insights} /> : <MapUnavailable />;
}
async function OrdersSection({ sections }: { sections: Sections }) {
  const data = await sections.orders;
  return data ? <OrdersPanel data={data} /> : <PanelUnavailable />;
}
async function PaymentsSection({ sections }: { sections: Sections }) {
  const data = await sections.payments;
  return data ? <PaymentsPanel data={data} /> : <PanelUnavailable />;
}
async function CustomersSection({ sections, now }: { sections: Sections; now: Date }) {
  const data = await sections.customers;
  return data ? <CustomersPanel data={data} now={now} /> : <PanelUnavailable />;
}
async function OperationsSection({ sections, modules }: { sections: Sections; modules: string[] }) {
  const [data, stock] = await Promise.all([sections.operations ?? null, sections.stock ?? null]);
  return (
    <OperationsPanel data={data} stock={stock} show={{
      fulfilment: modules.includes(FULFILMENT_MODULE), returns: modules.includes(RETURNS_MODULE),
      tickets: modules.includes(TICKETS_MODULE), feedback: modules.includes(FEEDBACK_MODULE), stock: modules.includes(ORDERS_MODULE),
    }} />
  );
}
async function SuggestionsSection({ staff, modules, now }: { staff: Staff; modules: string[]; now: Date }) {
  const suggestions = await loadSuggestions({ source: database(), crms: crmsDatabase() }, staff, modules, now).catch(() => null);
  return suggestions ? <SuggestionCards initial={suggestions} canDecide={shopRole(staff.role) === "manager"} /> : <SuggestionsUnavailable />;
}

/**
 * AI Insights: suggestions, Unusual activity, where Orders go, and the figures behind them. Manager-level Roles act;
 * Admin view; Staff go back to the Summary. Nothing here changes the shop.
 */
export default async function AiInsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireModule(DASHBOARD_MODULE);
  if (!canSeeAiInsights(staff.role)) redirect("/dashboard");
  const canDismiss = shopRole(staff.role) === "manager";

  const raw = (await searchParams).period;
  const preset = PERIOD_PRESETS.find((p) => p === (Array.isArray(raw) ? raw[0] : raw)) ?? "7-days";
  const now = new Date();
  const period = resolvePeriod(preset, now);
  const modules = await heldModules(AI_INSIGHTS_MODULES);
  const sections = loadSections({ source: database(), crms: crmsDatabase() }, modules, period, now);
  const has = (...wanted: string[]) => wanted.some((m) => modules.includes(m));

  const tab = (value: string, label: string, content: React.ReactNode) => ({
    value, label, content: <Suspense key={`${value}:${preset}`} fallback={<PanelSkeleton />}>{content}</Suspense>,
  });
  const tabs = [
    ...(has(ORDERS_MODULE) ? [tab("orders", "Orders", <OrdersSection sections={sections} />)] : []),
    ...(has(PAYMENTS_MODULE) ? [tab("payments", "Payments", <PaymentsSection sections={sections} />)] : []),
    ...(has(CUSTOMER_PROFILES_MODULE) ? [tab("customers", "Customers", <CustomersSection sections={sections} now={now} />)] : []),
    ...(has(ORDERS_MODULE, FULFILMENT_MODULE, RETURNS_MODULE, TICKETS_MODULE, FEEDBACK_MODULE)
      ? [tab("operations", "Stock, delivery & service", <OperationsSection sections={sections} modules={modules} />)] : []),
  ];

  return (
    <PeriodNavigation preset={preset} basePath={AI_INSIGHTS_PATH}>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-7 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 space-y-1 leading-[normal]">
            <h1 className="text-2xl font-semibold text-[#18181b]">AI Insights</h1>
            <p className="text-sm text-[#71717a]">What the figures say, and what a person could do next</p>
          </div>
          <PeriodPicker exportable={false} />
        </div>
        <Suspense fallback={<SuggestionsSkeleton />}>
          <SuggestionsSection staff={staff} modules={modules} now={now} />
        </Suspense>
        <UnusualActivityCards
          canDismiss={canDismiss}
          emptyState={
            <section aria-label="Unusual activity" className="rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]">
              <h2 className="text-[13px] font-medium text-[#71717a]">Unusual activity</h2>
              <p className="mt-2 text-sm text-[#71717a]">No unusual activity right now.</p>
            </section>
          }
        />
        {has(ORDERS_MODULE) && (
          <Suspense key={preset} fallback={<AreaMapSkeleton />}>
            <AreaMapSection sections={sections} />
          </Suspense>
        )}
        <InsightTabs tabs={tabs} />
      </div>
    </PeriodNavigation>
  );
}
