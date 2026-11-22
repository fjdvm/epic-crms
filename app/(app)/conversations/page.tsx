import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { allowedScope, loadConversations, scopesFor } from "@/features/tickets/conversations";
import { ConversationsView } from "@/features/tickets/conversations-view";
import { ChatSearchInput } from "@/features/tickets/ticket-toolbar";
import { ticketFileStorage } from "@/features/files/server";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { canWork, shopRole } from "@/lib/portal/roles";
import { ticketsDatabase } from "@/lib/tickets-db";
import { searchParamsKey } from "@/lib/search-params-key";
import { openEscalatedIds } from "@/features/tickets/escalate";
import { crmsDatabase } from "@/lib/crms-db";
import { ConversationsSkeleton } from "@/features/tickets/conversations-skeleton";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Nothing here waits on the Portal or the database, so the skeleton reaches the browser at once. Keyed so a
// new tab, filter or page shows it at once too, instead of holding the old view until the data lands.
export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const raw = await searchParams;

  return (
    <div className="lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      {/* One card: the search sits at the top of the inbox column, outside the keyed Suspense so typing keeps its focus. */}
      <div className="grid w-full grid-cols-1 overflow-hidden bg-white lg:h-full lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
        <div className="border-b border-[#e6e1ee] p-2 lg:col-start-1 lg:row-start-1 lg:border-r">
          <ChatSearchInput
            label="Search chats"
            placeholder="Ticket no., customer, email or order"
          />
        </div>
        <Suspense key={searchParamsKey(raw)} fallback={<ConversationsSkeleton />}>
          <ConversationsData raw={raw} />
        </Suspense>
      </div>
    </div>
  );
}

async function ConversationsData({ raw }: { raw: Awaited<SearchParams> }) {
  const staff = await requireModule(TICKETS_MODULE);

  const ticket = raw.ticket;
  const asked = Array.isArray(ticket) ? ticket[0] : ticket;
  const selectedId =
    asked && /^\d{1,9}$/.test(asked) ? Number(asked) : undefined;

  const asking = raw.q;
  const query = ((Array.isArray(asking) ? asking[0] : asking) ?? "").trim();

  const picked = Array.isArray(raw.tab) ? raw.tab[0] : raw.tab;
  const role = shopRole(staff.role);
  const scope = allowedScope(role, picked);

  const result = await loadConversations(
    ticketsDatabase,
    staff.username,
    selectedId,
    ticketFileStorage,
    query,
    scope,
    role === "manager" || role === "admin",
  );

  const escalatedIds = await openEscalatedIds(crmsDatabase()).catch(() => [] as number[]);

  if (!result.ok) {
    return (
      <Alert variant="destructive" className="col-span-full m-5 w-auto">
        <AlertTitle>Conversations are temporarily unavailable</AlertTitle>
        <AlertDescription>
          CREOMS could not read the store&apos;s Tickets. Reload to try again;
          if it keeps happening, tell whoever maintains CREOMS.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <ConversationsView
      conversations={result.conversations}
      viewerId={staff.username}
      viewerName={staff.name}
      query={query}
      scope={scope}
      scopes={scopesFor(role)}
      canDraft={canWork(staff)}
      readOnly={!canWork(staff)}
      escalatedIds={escalatedIds}
    />
  );
}
