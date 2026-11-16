import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ReassignAllDialog } from "@/features/tickets/reassign-dialog";
import Link from "next/link";

import { mayReadTicketReport } from "@/features/reports/ticket-report";
import { shopRole } from "@/lib/portal/roles";
import { NewTicketDialog } from "@/features/tickets/new-ticket-dialog";
import {
  TicketListSkeleton,
  TicketListView,
} from "@/features/tickets/ticket-list";
import { parseTicketParams } from "@/features/tickets/ticket-params";
import { TicketToolbar } from "@/features/tickets/ticket-toolbar";
import {
  listTicketFilterOptions,
  loadTickets,
  type TicketFilterOptions,
  type TicketListResult,
} from "@/features/tickets/tickets";
import { openEscalatedIds } from "@/features/tickets/escalate";
import { readServiceLevels } from "@/features/tickets/service-level-store";
import { crmsDatabase } from "@/lib/crms-db";
import { REPORTS_MODULE, TICKETS_MODULE } from "@/lib/portal/config";
import { heldModules, requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";
import { searchParamsKey } from "@/lib/search-params-key";
import { Skeleton } from "@/components/ui/skeleton";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Nothing here waits on the Portal or the database, so the page frame reaches the browser at once. The
// search box and filters sit outside the keyed part, so they stay put while typing; the list is keyed so a
// new tab, search, filter or page shows its skeleton at once instead of holding the old rows until the data lands.
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const raw = await searchParams;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">
            Tickets
          </h1>
          <p className="text-sm leading-[normal] text-[#6e6680]">
            Every Ticket, claimed or not, and who claimed it. Each links to a
            customer, and to an order when it is about one.
          </p>
        </div>
        <Suspense fallback={null}>
          <ReassignAllEntry />
        </Suspense>
        <Suspense fallback={null}>
          <ReportsEntry />
        </Suspense>
        <NewTicketDialog />
      </div>
      <Suspense
        fallback={<Skeleton className="h-9 w-[320px] max-w-full shrink-0" />}
      >
        <TicketToolbarData />
      </Suspense>
      <Suspense key={searchParamsKey(raw)} fallback={<TicketListSkeleton />}>
        <TicketsData raw={raw} />
      </Suspense>
    </div>
  );
}

/** Only a CREOMS Manager is offered "Reassign all"; Staff, Admin and CEO see no button. */
async function ReassignAllEntry() {
  const staff = await requireModule(TICKETS_MODULE);

  return shopRole(staff.role) === "manager" ? <ReassignAllDialog /> : null;
}

/** Manager, Admin and CEO who hold the Reports Module are offered the Ticket reports; Staff see no link. */
async function ReportsEntry() {
  const staff = await requireModule(TICKETS_MODULE);
  if (!mayReadTicketReport(staff.role) || !(await heldModules([REPORTS_MODULE])).includes(REPORTS_MODULE)) return null;

  return (
    <Link href="/tickets/reports" prefetch className="shrink-0 rounded-lg border border-[#e4e4e7] bg-white px-3.5 py-2 text-sm font-medium text-[#18181b]">
      Reports
    </Link>
  );
}

async function TicketToolbarData() {
  await requireModule(TICKETS_MODULE);

  let options: TicketFilterOptions = { categories: [], claimers: [] };

  try {
    options = await listTicketFilterOptions(ticketsDatabase());
  } catch (error) {
    console.error("Tickets could not read the filter choices", error);
  }

  return <TicketToolbar options={options} />;
}

async function TicketsData({ raw }: { raw: Awaited<SearchParams> }) {
  const staff = await requireModule(TICKETS_MODULE);
  const params = parseTicketParams(raw);

  const levels = await readServiceLevels(crmsDatabase);
  // The escalations are CREOMS's own; if they cannot be read the list still opens, without the badge.
  const escalatedIds = await openEscalatedIds(crmsDatabase()).catch((error) => {
    console.error("Escalations could not be read", error);

    return [];
  });
  const result: TicketListResult = levels
    ? await loadTickets(ticketsDatabase, { ...params, viewerId: staff.username, levels, escalatedIds })
    : { ok: false };

  if (!result.ok) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Tickets are temporarily unavailable</AlertTitle>
        <AlertDescription>
          CREOMS could not read the store&apos;s Tickets. Reload to try again;
          if it keeps happening, tell whoever maintains CREOMS.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <TicketListView
      list={result.list}
      params={{ ...params, page: result.list.page }}
    />
  );
}
