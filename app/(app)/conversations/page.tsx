import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadConversations } from "@/features/tickets/conversations";
import { ConversationsView } from "@/features/tickets/conversations-view";
import { ChatSearchInput } from "@/features/tickets/ticket-toolbar";
import { ticketFileStorage } from "@/features/files/server";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { canWork } from "@/lib/portal/roles";
import { ticketsDatabase } from "@/lib/tickets-db";
import { searchParamsKey } from "@/lib/search-params-key";
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
    <div className="flex flex-col gap-5 px-8 py-7 lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">
            Conversations
          </h1>
          <p className="text-sm leading-[normal] text-[#6e6680]">
            Your claimed Tickets, one chat each, newest activity first. To read
            any other Ticket, open it from Tickets.
          </p>
        </div>
        <ChatSearchInput
          label="Search chats"
          placeholder="Ticket no., customer, email or order"
        />
      </div>
      <Suspense key={searchParamsKey(raw)} fallback={<ConversationsSkeleton />}>
        <ConversationsData raw={raw} />
      </Suspense>
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

  const result = await loadConversations(
    ticketsDatabase,
    staff.username,
    selectedId,
    ticketFileStorage,
    query,
  );

  if (!result.ok) {
    return (
      <Alert variant="destructive">
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
      canDraft={canWork(staff)}
    />
  );
}
