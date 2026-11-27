import Link from "next/link";

import { ArrowRight, MessageCircle } from "lucide-react";

import { cn } from "@/lib/utils";

import { Conversation } from "./conversation";
import { ChatLink } from "./conversations-navigation";
import { draftDisabledReason } from "./draft";
import { NotesProvider } from "./notes";
import { CHAT_SCOPES, inboxTime, type ChatScope, type ConversationRow, type Conversations } from "./conversations";
import { ClaimedBy, ClaimProvider } from "./claim";
import { HoldProvider, HoldSummary } from "./hold";
import { TicketActions } from "./ticket-controls";
import { TicketMoreMenu } from "./ticket-more-menu";

const TAB_LABELS: Record<ChatScope, string> = { mine: "Mine", unclaimed: "Unclaimed", all: "All" };

/** The inbox column: the tabs and the chats. */
export function ConversationInbox({
  chats,
  selectedId,
  now = new Date(),
  query = "",
  scope = "mine",
  scopes = CHAT_SCOPES,
}: {
  chats: ConversationRow[];
  /** The chat the page has open, highlighted until another is clicked. */
  selectedId?: number;
  now?: Date;
  /** The search narrowing the chats: opening a chat keeps it, and an empty inbox says nothing matched. */
  query?: string;
  /** The inbox tab: kept in every link so opening a chat stays on the same tab. */
  scope?: ChatScope;
  /** The tabs this Role may open, in order; the server has already clamped `scope` to one of them. */
  scopes?: ChatScope[];
}) {
  const searching = query !== "";
  const href = (tab: ChatScope, ticket?: number) => {
    const params = new URLSearchParams();
    if (ticket !== undefined) params.set("ticket", String(ticket));
    if (tab !== scopes[0]) params.set("tab", tab);
    if (searching) params.set("q", query);
    const text = params.toString();

    return text ? `/conversations?${text}` : "/conversations";
  };

  return (
    <div className="flex h-[40vh] w-full min-h-0 flex-col border-b border-[#e6e1ee] lg:col-start-1 lg:row-start-2 lg:h-auto lg:border-r lg:border-b-0">
      <div role="tablist" aria-label="Inbox" className="flex shrink-0 gap-1 p-2">
        {scopes.map((tab) => (
          <Link
            key={tab}
            role="tab"
            aria-selected={tab === scope}
            href={href(tab)}
            className={cn(
              "flex-1 rounded-md px-3 py-1 text-center text-[15px] font-medium leading-[normal]",
              tab === scope ? "bg-[#efe6f8] text-[#5b2a86]" : "text-[#6e6680]",
            )}
          >
            {TAB_LABELS[tab]}
          </Link>
        ))}
      </div>
      <nav aria-label="Chats" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {chats.length === 0 && (
          <p className="px-4 py-2 text-[15px] leading-[normal] text-[#6e6680]">
            {searching ? "No chats match this search." : "No chats yet."}
          </p>
        )}
        {chats.map((chat) => (
          <ChatLink
            key={chat.ticketId}
            ticketId={chat.ticketId}
            href={href(scope, chat.ticketId)}
            current={chat.ticketId === selectedId}
            className="flex items-start gap-3 border-b border-[#f0ecf5] px-3 py-2.5 aria-[current=true]:bg-[#efe6f8]"
          >
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e6e1ee] text-[#3e3650]"
            >
              <MessageCircle className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-[normal] text-[#1f1a2e]">
                  {chat.customerName}{" "}
                  <span className="text-[13px] font-medium text-[#5b2a86]">TKT-{chat.ticketId}</span>
                </span>
                <span className="shrink-0 text-[13px] leading-[normal] whitespace-nowrap text-[#6e6680]">
                  {inboxTime(chat.lastActivity, now)}
                </span>
              </span>
              <span className="truncate text-sm leading-[normal] text-[#6e6680]">{chat.preview}</span>
            </span>
          </ChatLink>
        ))}
      </nav>
    </div>
  );
}

interface ChatProps {
  viewerId: string;
  viewerName: string;
  query?: string;
  /** Staff and Managers only; Admin see no draft button. */
  canDraft?: boolean;
  /** Admin: read the chats, no reply box, notes, AI or claim buttons. */
  readOnly?: boolean;
  /** Tickets a Manager has already been asked about, so the menu does not offer Escalate again. */
  escalatedIds?: number[];
}

/** The chat column: the open chat, or why there is none. */
export function ConversationChat({
  selected,
  viewerId,
  viewerName,
  query = "",
  canDraft = false,
  readOnly = false,
  escalatedIds = [],
}: ChatProps & { selected: Conversations["selected"] }) {
  return selected ? (
    <SelectedChat ticket={selected} viewerId={viewerId} viewerName={viewerName} canDraft={canDraft} readOnly={readOnly} escalated={escalatedIds.includes(selected.id)} />
  ) : (
    <section className="flex h-[30vh] w-full min-w-0 items-center justify-center p-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-auto">
      <p className="text-sm leading-[normal] text-[#6e6680]">
        {query !== "" ? "No chat matches this search." : "When a Customer opens a Ticket, its chat appears here."}
      </p>
    </section>
  );
}

/** The inbox on the left and the open chat on the right. The page loads the two apart; this holds them together. */
export function ConversationsView({
  conversations,
  now,
  scope,
  scopes,
  ...chat
}: ChatProps & { conversations: Conversations; now?: Date; scope?: ChatScope; scopes?: ChatScope[] }) {
  return (
    <>
      <ConversationInbox chats={conversations.chats} selectedId={conversations.selected?.id} now={now} query={chat.query} scope={scope} scopes={scopes} />
      <ConversationChat selected={conversations.selected} {...chat} />
    </>
  );
}

function SelectedChat({
  ticket,
  viewerId,
  viewerName,
  canDraft,
  readOnly,
  escalated,
}: {
  ticket: NonNullable<Conversations["selected"]>;
  viewerId: string;
  viewerName: string;
  canDraft: boolean;
  readOnly: boolean;
  escalated: boolean;
}) {
  const { order, customer } = ticket;
  const isClaimer = ticket.claimerId !== null && ticket.claimerId === viewerId;

  return (
    <ClaimProvider
      ticketId={ticket.id}
      claimer={ticket.claimerId !== null ? { id: ticket.claimerId, name: ticket.claimerName ?? "" } : null}
      viewer={{ id: viewerId, name: viewerName }}
    >
      <HoldProvider ticketId={ticket.id} status={ticket.status} hold={ticket.hold}>
        <NotesProvider key={ticket.id} ticketId={ticket.id} viewerName={viewerName}>
          <section aria-label="Chat" className="flex h-[70vh] min-h-0 w-full min-w-0 flex-col lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-auto">
            <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-[#e6e1ee] px-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-semibold leading-[normal] text-[#1f1a2e]">
                  {customer.name} · TKT-{ticket.id}
                </h2>
                <p className="truncate text-sm leading-[normal] text-[#6e6680]">
                  <ClaimedBy />
                  {order && ` · BR-${order.id}`}
                </p>
              </div>
              {!readOnly && <TicketActions ticketId={ticket.id} withReply={false} withRelease={false} />}
              <Link
                href={`/tickets/${ticket.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e6e1ee] bg-white px-[14px] py-[9px] text-sm font-medium whitespace-nowrap leading-[normal] text-[#1f1a2e]"
              >
                <ArrowRight aria-hidden className="size-3.5" />
                Open ticket
              </Link>
              {!readOnly && <TicketMoreMenu ticketId={ticket.id} canEscalate={!escalated} />}
            </header>
            <HoldSummary />
            <Conversation
              // A different chat starts from its own saved and live Messages.
              key={ticket.id}
              ticketId={ticket.id}
              messages={ticket.messages}
              viewerName={viewerName}
              customerName={customer.name.split(" ")[0]}
              scrollable
              canNote={!readOnly}
              readOnly={readOnly}
              draftDisabledReason={canDraft ? draftDisabledReason(ticket.status, isClaimer) : undefined}
              canReply={ticket.status !== "completed" && isClaimer}
              note={
                ticket.status === "completed"
                  ? "This Ticket is resolved, so the chat is read-only. The Customer can reopen it on the storefront."
                  : ticket.claimerName
                    ? `${ticket.claimerName} claimed this Ticket, so only they can reply.`
                    : "Claim this Ticket to reply."
              }
            />
          </section>
        </NotesProvider>
      </HoldProvider>
    </ClaimProvider>
  );
}
