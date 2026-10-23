import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { ReturnListView } from "@/features/returns/return-list";
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

  const [result, stats] = await Promise.all([
    loadReturns(ticketsDatabase, { status: tab, page }),
    loadReturnStats(ticketsDatabase),
  ]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <BackgroundRefresh />
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Returns</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Customers&apos; requests to refund Order items, shown here as the store has them
        </p>
      </div>
      {result.ok ? (
        <ReturnListView
          list={result.list}
          stats={stats.ok ? stats.stats : null}
          params={{ tab, page: result.list.page }}
        />
      ) : (
        <Alert variant="destructive">
          <AlertTitle>Returns are temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s Returns. Reload to try again; if it keeps happening, tell whoever
            maintains CREOMS.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
