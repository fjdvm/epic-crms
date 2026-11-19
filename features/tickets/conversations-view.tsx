import Link from "next/link";

import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { Conversation } from "./conversation";
import { draftDisabledReason } from "./draft";
import { NotesProvider } from "./notes";
import { CHAT_SCOPES, inboxTime, type ChatScope, type Conversations } from "./conversations";
import { initials } from "./image-viewer";
import { ClaimedBy, ClaimProvider } from "./claim";
import { HoldProvider, HoldSummary } from "./hold";
import { TicketActions } from "./ticket-controls";

const TAB_LABELS: Record<ChatScope, string> = { mine: "Mine", unclaimed: "Unclaimed", all: "All" };

/** The Conversations page as designed: one card with the inbox on the left and the open chat on the right. */
export function ConversationsView({
  conversations,
  viewerId,
  viewerName,
  now = new Date(),
  query = "",
  scope = "mine",
  scopes = CHAT_SCOPES,
  canDraft = false,
  readOnly = false,
}: {
  conversations: Conversations;
  viewerId: string;
  viewerName: string;
  now?: Date;
  /** The search narrowing the chats: opening a chat keeps it, and an empty inbox says nothing matched. */
  query?: string;
  /** The inbox tab: kept in every link so opening a chat stays on the same tab. */
  scope?: ChatScope;
  /** The tabs this Role may open, in order; the server has already clamped `scope` to one of them. */
  scopes?: ChatScope[];
  /** Staff and Managers only; Admin and CEO see no draft button. */
  canDraft?: boolean;
  /** Admin and CEO: read the chats, no reply box, notes, AI or claim buttons. */
  readOnly?: boolean;
}) {
  const { chats, selected } = conversations;
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
    <div className="flex w-full flex-col overflow-hidden rounded-xl border border-[#e6e1ee] bg-white lg:min-h-0 lg:flex-1 lg:flex-row">
      <div className="flex h-[40vh] w-full flex-col border-b border-[#e6e1ee] lg:h-full lg:w-[300px] lg:shrink-0 lg:border-r lg:border-b-0">
        <div role="tablist" aria-label="Inbox" className="flex shrink-0 gap-1 p-3">
          {scopes.map((tab) => (
            <Link
              key={tab}
              role="tab"
              aria-selected={tab === scope}
              href={href(tab)}
              className={cn(
                "rounded-md px-3 py-1 text-[13px] font-medium leading-[normal]",
                tab === scope ? "bg-[#efe6f8] text-[#5b2a86]" : "text-[#6e6680]",
              )}
            >
              {TAB_LABELS[tab]}
            </Link>
          ))}
        </div>
        <nav aria-label="Chats" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {chats.length === 0 && (
            <p className="px-4 py-2 text-[13px] leading-[normal] text-[#6e6680]">
              {searching ? "No chats match this search." : "No chats yet."}
            </p>
          )}
          {chats.map((chat) => (
            <Link
              key={chat.ticketId}
              href={href(scope, chat.ticketId)}
              aria-current={chat.ticketId === selected?.id ? "true" : undefined}
              className={cn(
                "flex items-start gap-3 border-b border-[#f0ecf5] px-4 py-3",
                chat.ticketId === selected?.id && "bg-[#efe6f8]",
              )}
            >
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e6e1ee] text-[11px] font-semibold text-[#3e3650]"
              >
                {initials(chat.customerName)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="flex items-start gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-[normal] text-[#1f1a2e]">
                    {chat.customerName}{" "}
                    <span className="text-[11px] font-medium text-[#5b2a86]">TKT-{chat.ticketId}</span>
                  </span>
                  <span className="shrink-0 text-[11px] leading-[normal] whitespace-nowrap text-[#6e6680]">
                    {inboxTime(chat.lastActivity, now)}
                  </span>
                </span>
                <span className="truncate text-xs leading-[normal] text-[#6e6680]">{chat.preview}</span>
              </span>
            </Link>
          ))}
        </nav>
      </div>

      {selected ? (
        <SelectedChat ticket={selected} viewerId={viewerId} viewerName={viewerName} canDraft={canDraft} readOnly={readOnly} />
      ) : (
        <section className="flex h-[30vh] w-full min-w-0 items-center justify-center p-5 lg:h-full lg:flex-1">
          <p className="text-sm leading-[normal] text-[#6e6680]">
            {searching ? "No chat matches this search." : "When a Customer opens a Ticket, its chat appears here."}
          </p>
        </section>
      )}
    </div>
  );
}

function SelectedChat({
  ticket,
  viewerId,
  viewerName,
  canDraft,
  readOnly,
}: {
  ticket: NonNullable<Conversations["selected"]>;
  viewerId: string;
  viewerName: string;
  canDraft: boolean;
  readOnly: boolean;
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
          <section aria-label="Chat" className="flex h-[70vh] min-h-0 w-full min-w-0 flex-col lg:h-full lg:flex-1">
            <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#e6e1ee] px-5 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[13px] font-semibold leading-[normal] text-[#1f1a2e]">
                  {customer.name} · TKT-{ticket.id}
                </h2>
                <p className="truncate text-[11px] leading-[normal] text-[#6e6680]">
                  <ClaimedBy />
                  {order && ` · BR-${order.id}`}
                </p>
              </div>
              {!readOnly && <TicketActions ticketId={ticket.id} withReply={false} className="flex-wrap" />}
              <Link
                href={`/tickets/${ticket.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e6e1ee] bg-white px-3 py-1.5 text-[13px] font-medium leading-[normal] text-[#1f1a2e]"
              >
                <ArrowRight aria-hidden className="size-3.5" />
                Open ticket
              </Link>
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
                  ? "The Customer completed this Ticket, so it can no longer be replied to."
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
