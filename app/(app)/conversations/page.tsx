import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadConversations } from "@/features/tickets/conversations";
import { ConversationsView } from "@/features/tickets/conversations-view";
import { gatewayFileStorage } from "@/lib/gateway";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ConversationsPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireModule(TICKETS_MODULE);

  const raw = (await searchParams).ticket;
  const asked = Array.isArray(raw) ? raw[0] : raw;
  const selectedId = asked && /^\d{1,9}$/.test(asked) ? Number(asked) : undefined;

  const result = await loadConversations(ticketsDatabase, staff.username, selectedId, gatewayFileStorage);

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
