import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { ReturnListView, type ReturnListParams } from "@/features/returns/return-list";
import { ReturnsSkeleton } from "@/features/returns/returns-skeleton";
import { PageHeader } from "./page-header";
import { loadReturns, loadReturnStats, RETURN_TABS } from "@/features/returns/returns";
import { ticketsDatabase } from "@/lib/tickets-db";
import { RETURNS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function ReturnsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireModule(RETURNS_MODULE);

  const raw = await searchParams;
  const tab = RETURN_TABS.find((t) => t === first(raw.tab)) ?? "requested";
  const page = Math.max(1, Number.parseInt(first(raw.page), 10) || 1);

  const params = { tab, page };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <BackgroundRefresh />
      <PageHeader />
      {/* Keyed so switching tab or page shows the skeleton at once instead of holding the old tab until the data lands. */}
      <Suspense key={`${tab}:${page}`} fallback={<ReturnsSkeleton params={params} />}>
        <ReturnsData params={params} />
      </Suspense>
    </div>
  );
}

async function ReturnsData({ params }: { params: ReturnListParams }) {
  const [result, stats] = await Promise.all([
    loadReturns(ticketsDatabase, { status: params.tab, page: params.page }),
    loadReturnStats(ticketsDatabase),
  ]);

  if (!result.ok) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Returns are temporarily unavailable</AlertTitle>
        <AlertDescription>
          CREOMS could not read the store&apos;s Returns. Reload to try again; if it keeps happening, tell whoever
          maintains CREOMS.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <ReturnListView
      list={result.list}
      stats={stats.ok ? stats.stats : null}
      params={{ tab: params.tab, page: result.list.page }}
    />
  );
}
