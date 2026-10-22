import Link from "next/link";

import { formatDate, formatWholePesos } from "@/features/customer-profiles/format";
import { orderAnchor } from "@/features/customer-profiles/orders";
import { orderLabel, paymentStatusOf, STAGE_LABELS } from "@/features/customer-profiles/rules";
import { cn } from "@/lib/utils";

import { Conversation } from "./conversation";
import { inboxTime, type Conversations } from "./conversations";
import { Pill, PILL, PRIORITY_LABELS, PRIORITY_PILLS } from "./pill";
import {
  CARD,
  CARD_LINK,
  CARD_TITLE,
  ORDER_PILLS,
  PAYMENT_PILLS,
  STAGE_PILLS,
  STATUS_LABELS,
  STATUS_PILLS,
} from "./ticket-detail";
import { ClaimerName, ClaimProvider } from "./claim";
import { TicketActions } from "./ticket-controls";

const FACT = "flex items-center gap-2 text-[13px] leading-[normal]";

/** The Conversations page as designed: the inbox, the open chat, and the Customer and Ticket cards. */
export function ConversationsView({
  conversations,
  viewerId,
  viewerName,
  now = new Date(),
}: {
  conversations: Conversations;
  viewerId: string;
  viewerName: string;
  now?: Date;
}) {
  const { chats, selected } = conversations;

  return (
    <div className="flex flex-col gap-5 px-8 py-7 lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Conversations</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          One inbox for every Ticket chat, newest activity first. Each chat belongs to a Ticket.
        </p>
      </div>

      <div className="flex flex-col items-start gap-4 lg:min-h-0 lg:w-full lg:flex-1 lg:flex-row">
        <nav
          aria-label="Chats"
          className="flex h-[40vh] w-full flex-col gap-1 overflow-y-auto rounded-xl border border-[#e6e1ee] bg-white px-2 py-3 lg:h-full lg:w-[300px] lg:shrink-0"
        >
          {chats.length === 0 && (
            <p className="px-3 py-2 text-[13px] leading-[normal] text-[#6e6680]">No chats yet.</p>
          )}
          {chats.map((chat) => (
            <Link
              key={chat.ticketId}
              href={`/conversations?ticket=${chat.ticketId}`}
              aria-current={chat.ticketId === selected?.id ? "true" : undefined}
              className={cn(
                "flex flex-col gap-[3px] rounded-lg px-3 py-[10px]",
                chat.ticketId === selected?.id && "bg-[#efe6f8]",
              )}
            >
              <span className="flex items-start gap-1.5">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-[normal] text-[#1f1a2e]">
                  {chat.customerName}
                </span>
                <span className="shrink-0 text-[11px] leading-[normal] whitespace-nowrap text-[#6e6680]">
                  {inboxTime(chat.lastActivity, now)}
                </span>
              </span>
              <span className="truncate text-[13px] leading-[normal] text-[#3e3650]">{chat.preview}</span>
              <span className="text-[11px] leading-[normal] font-medium text-[#5b2a86]">
                TKT-{chat.ticketId}
              </span>
            </Link>
          ))}
        </nav>

        {selected ? (
          <SelectedChat ticket={selected} viewerId={viewerId} viewerName={viewerName} />
        ) : (
          <section className={cn(CARD, "w-full min-w-0 lg:flex-1")}>
            <p className="text-sm leading-[normal] text-[#6e6680]">
              When a Customer opens a Ticket, its chat appears here.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function SelectedChat({
  ticket,
  viewerId,
  viewerName,
}: {
  ticket: NonNullable<Conversations["selected"]>;
  viewerId: string;
  viewerName: string;
}) {
  const { order, customer } = ticket;
  const isClaimer = ticket.claimerId !== null && ticket.claimerId === viewerId;

  return (
    <ClaimProvider
      ticketId={ticket.id}
      claimer={ticket.claimerId !== null ? { id: ticket.claimerId, name: ticket.claimerName ?? "" } : null}
      viewer={{ id: viewerId, name: viewerName }}
    >
      <section aria-label="Chat" className={cn(CARD, "flex h-[70vh] min-h-0 w-full min-w-0 flex-col space-y-0 gap-3 lg:h-full lg:flex-1")}>
        <div className="flex items-center gap-2">
          <h2 className={cn(CARD_TITLE, "min-w-0 flex-1 truncate")}>{customer.name}</h2>
          <span className="shrink-0 text-[13px] leading-[normal] font-medium text-[#5b2a86]">
            TKT-{ticket.id}
          </span>
        </div>
        <Conversation
          // A different chat starts from its own saved and live Messages.
          key={ticket.id}
          ticketId={ticket.id}
          messages={ticket.messages}
          viewerName={viewerName}
          customerName={customer.name.split(" ")[0]}
          scrollable
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

      <div className="w-full space-y-4 lg:h-full lg:w-[320px] lg:shrink-0 lg:overflow-y-auto">
        <section aria-label="Customer" className={CARD}>
          <div className="flex items-center gap-2">
            <h2 className={cn(CARD_TITLE, "flex-1")}>Customer</h2>
            <Pill className={STAGE_PILLS[customer.stage]}>{STAGE_LABELS[customer.stage]}</Pill>
          </div>
          <p className="text-base font-medium leading-[normal] text-[#1f1a2e]">{customer.name}</p>
          <p className="text-xs leading-[normal] text-[#6e6680]">
            {customer.orders} {customer.orders === 1 ? "order" : "orders"} ·{" "}
            {formatWholePesos(customer.totalSpent)} total spent
          </p>
          <Link href={`/customer-profiles/${customer.id}`} className={CARD_LINK}>
            View customer profile →
          </Link>
        </section>

        <section aria-label="Ticket" className={CARD}>
          <div className="flex items-center gap-2">
            <h2 className={cn(CARD_TITLE, "flex-1")}>TKT-{ticket.id}</h2>
            <Pill className={STATUS_PILLS[ticket.status]}>{STATUS_LABELS[ticket.status]}</Pill>
          </div>
          <p className="text-base font-medium leading-[normal] text-[#1f1a2e]">{ticket.subject}</p>
          <div className="space-y-1.5 text-[#6e6680]">
            <p className={FACT}>
              Priority <Pill className={PRIORITY_PILLS[ticket.priority]}>{PRIORITY_LABELS[ticket.priority]}</Pill>
            </p>
            <p className={FACT}>
              Assigned to{" "}
              <span className="text-[#1f1a2e]">
                <ClaimerName />
              </span>
            </p>
            <p className={FACT}>Opened {formatDate(ticket.openedAt)}</p>
            <div className={FACT}>
              Linked order
              {order ? (
                <span className="flex flex-wrap items-center gap-1.5 text-[#1f1a2e]">
                  <Link
                    href={`/customer-profiles/${customer.id}#${orderAnchor(order.id)}`}
                    className="font-medium text-[#5b2a86]"
                  >
                    #{order.id}
                  </Link>
                  <Pill className={PAYMENT_PILLS[paymentStatusOf(order.status)]}>
                    {paymentStatusOf(order.status)}
                  </Pill>
                  <Pill className={ORDER_PILLS[order.status] ?? PILL.grey}>{orderLabel(order.status)}</Pill>
                </span>
              ) : (
                <span className="text-[#1f1a2e]">None yet</span>
              )}
            </div>
          </div>
          <TicketActions
            ticketId={ticket.id}
            status={ticket.status}
            withReply={false}
            className="flex-wrap"
          />
          <Link href={`/tickets/${ticket.id}`} className={CARD_LINK}>
            Open ticket →
          </Link>
        </section>
      </div>
    </ClaimProvider>
  );
}
