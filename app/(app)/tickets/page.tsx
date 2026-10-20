import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TicketListView } from "@/features/tickets/ticket-list";
import { loadTickets, TICKET_TABS } from "@/features/tickets/tickets";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function TicketsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireModule(TICKETS_MODULE);

  const raw = await searchParams;
  const tab = TICKET_TABS.find((t) => t === first(raw.tab)) ?? "open";
  const page = Math.max(1, Number.parseInt(first(raw.page), 10) || 1);

  const result = await loadTickets(ticketsDatabase, { tab, page });

  if (!result.ok) {
    return (
      <div className="p-md sm:p-lg space-y-md">
        <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Tickets</h1>
        <Alert variant="destructive">
          <AlertTitle>Tickets are temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s Tickets. Reload to try again; if it keeps
            happening, tell whoever maintains CREOMS.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { list } = result;

  return (
    <div className="space-y-5 px-xl py-7">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Tickets</h1>
        <p className="text-sm text-muted-foreground">
          {list.counts.open} open · {list.overdue} overdue
        </p>
      </div>
      <TicketListView list={list} params={{ tab, page: list.page }} />
    </div>
  );
}
