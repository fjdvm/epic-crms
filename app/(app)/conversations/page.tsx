import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadConversations } from "@/features/tickets/conversations";
import { ConversationsView } from "@/features/tickets/conversations-view";
import { ticketFileStorage } from "@/features/files/server";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";
import { searchParamsKey } from "@/lib/search-params-key";
import Loading from "./loading";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Nothing here waits on the Portal or the database, so the skeleton reaches the browser at once. Keyed so a
// new tab, filter or page shows it at once too, instead of holding the old view until the data lands.
export default async function ConversationsPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;

  return (
    <Suspense key={searchParamsKey(raw)} fallback={<Loading />}>
      <ConversationsData raw={raw} />
    </Suspense>
  );
}

async function ConversationsData({ raw }: { raw: Awaited<SearchParams> }) {
  const staff = await requireModule(TICKETS_MODULE);

  const ticket = raw.ticket;
  const asked = Array.isArray(ticket) ? ticket[0] : ticket;
  const selectedId = asked && /^\d{1,9}$/.test(asked) ? Number(asked) : undefined;

  const result = await loadConversations(ticketsDatabase, staff.username, selectedId, ticketFileStorage);

  if (!result.ok) {
    return (
      <div className="p-md sm:p-lg space-y-md">
        <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Conversations</h1>
        <Alert variant="destructive">
          <AlertTitle>Conversations are temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s Tickets. Reload to try again; if it keeps
            happening, tell whoever maintains CREOMS.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <ConversationsView
      conversations={result.conversations}
      viewerId={staff.username}
      viewerName={staff.name}
    />
  );
}
