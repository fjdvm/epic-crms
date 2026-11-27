import { cache, Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { allowedScope, inboxKey, loadChats, loadOpenChat, openChatId, scopesFor } from "@/features/tickets/conversations";
import { ChatPane, ConversationsNavigation } from "@/features/tickets/conversations-navigation";
import { ConversationChat, ConversationInbox } from "@/features/tickets/conversations-view";
import { ChatSearchInput } from "@/features/tickets/ticket-toolbar";
import { ticketFileStorage } from "@/features/files/server";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { canWork, shopRole } from "@/lib/portal/roles";
import { ticketsDatabase } from "@/lib/tickets-db";
import { searchParamsKey } from "@/lib/search-params-key";
import { openEscalatedIds } from "@/features/tickets/escalate";
import { crmsDatabase } from "@/lib/crms-db";
import { ChatSkeleton, InboxSkeleton } from "@/features/tickets/conversations-skeleton";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Nothing here waits on the Portal or the database, so the skeleton reaches the browser at once. The inbox and
// the chat load behind their own boundaries: opening a chat reloads only the chat, a new tab or search both.
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
        <div className="flex h-[60px] items-center border-b border-[#e6e1ee] px-2 *:w-full lg:col-start-1 lg:row-start-1 lg:border-r">
          <ChatSearchInput
            label="Search chats"
            placeholder="Ticket no., customer, email or order"
          />
        </div>
        <ConversationsNavigation>
          <Suspense key={`inbox:${inboxKey(raw)}`} fallback={<InboxSkeleton />}>
            <InboxData raw={raw} />
          </Suspense>
          <ChatPane>
            <Suspense key={`chat:${searchParamsKey(raw)}`} fallback={<ChatSkeleton />}>
              <ChatData raw={raw} />
            </Suspense>
          </ChatPane>
        </ConversationsNavigation>
      </div>
    </div>
  );
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** What both columns need, read once per request. The Module is proved before anything is read. */
const loadInbox = cache(async (raw: Awaited<SearchParams>) => {
  const staff = await requireModule(TICKETS_MODULE);

  const asked = first(raw.ticket);
  const selectedId = asked && /^\d{1,9}$/.test(asked) ? Number(asked) : undefined;
  const query = (first(raw.q) ?? "").trim();
  const role = shopRole(staff.role);
  const scope = allowedScope(role, first(raw.tab));

  const result = await loadChats(ticketsDatabase, staff.username, query, scope);
  const openId = result.ok ? openChatId(result.chats, selectedId, role === "manager" || role === "admin") : undefined;

  return { staff, role, query, scope, result, openId };
});

async function InboxData({ raw }: { raw: Awaited<SearchParams> }) {
  const { role, query, scope, result, openId } = await loadInbox(raw);

  if (!result.ok) return <Unavailable />;

  return <ConversationInbox chats={result.chats} selectedId={openId} query={query} scope={scope} scopes={scopesFor(role)} />;
}

async function ChatData({ raw }: { raw: Awaited<SearchParams> }) {
  const { staff, query, result, openId } = await loadInbox(raw);

  // The inbox says the read failed, across both columns.
  if (!result.ok) return null;

  const [chat, escalatedIds] = await Promise.all([
    loadOpenChat(ticketsDatabase, openId, ticketFileStorage),
    openEscalatedIds(crmsDatabase()).catch(() => [] as number[]),
  ]);

  if (!chat.ok) return <Unavailable chatOnly />;

  return (
    <ConversationChat
      selected={chat.selected}
      viewerId={staff.username}
      viewerName={staff.name}
      query={query}
      canDraft={canWork(staff)}
      readOnly={!canWork(staff)}
      escalatedIds={escalatedIds}
    />
  );
}

function Unavailable({ chatOnly = false }: { chatOnly?: boolean }) {
  return (
    <Alert variant="destructive" className={chatOnly ? "m-5 h-fit w-auto lg:col-start-2 lg:row-span-2 lg:row-start-1" : "col-span-full m-5 w-auto"}>
      <AlertTitle>Conversations are temporarily unavailable</AlertTitle>
      <AlertDescription>
        CREOMS could not read the store&apos;s Tickets. Reload to try again;
        if it keeps happening, tell whoever maintains CREOMS.
      </AlertDescription>
    </Alert>
  );
}
