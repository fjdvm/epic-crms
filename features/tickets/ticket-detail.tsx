import { BackButton } from "@/components/shared/back-button";
import type { ReactNode } from "react";
import Link from "next/link";

import { formatDate, formatWholePesos } from "@/features/customer-profiles/format";
import { orderAnchor } from "@/features/customer-profiles/orders";
import { orderLabel, paymentStatusOf, STAGE_LABELS, type Stage } from "@/features/customer-profiles/rules";
import { cn } from "@/lib/utils";

import { PILL, Pill, PRIORITY_LABELS } from "./pill";
import { Bubbles } from "./conversation";
import { NoteBox, NotesProvider } from "./notes";
import { MessageAttachment } from "./message-attachment";
import { ByClaimer, ClaimerName, ClaimProvider } from "./claim";
import { EscalatedPill, EscalationSummary } from "./escalate-ui";
import { escalationReasonLabel } from "./escalate-reasons";
import type { EscalationRecord } from "./escalate";
import { HoldProvider, HoldSummary, StatusPill } from "./hold";
import { TicketActions } from "./ticket-controls";
import { SummaryCard } from "./summary-card";
import { SuggestCard } from "./suggest-card";
import type { SerializedSuggestion } from "./suggest-view";
import { ServiceLevelPanel } from "./service-level-panel";
import type { ReassignmentRecord } from "./reassign";
import type { TicketDetail, TicketMessage } from "./ticket";
import type { TicketStatus } from "./tickets";

export { STATUS_LABELS, STATUS_PILLS } from "./status";

export const STAGE_PILLS: Record<Stage, string> = {
  new: PILL.blue,
  "first-order": PILL.blue,
  repeat: PILL.purple,
  "at-risk": PILL.amber,
  lost: PILL.grey,
};

export const PAYMENT_PILLS = {
  Paid: PILL.green,
  Unpaid: PILL.amber,
  Cancelled: PILL.grey,
} as const;

export const ORDER_PILLS: Record<string, string> = {
  dispatched: PILL.blue,
  delivered: PILL.green,
  cancelled: PILL.grey,
};

export const CARD = "space-y-[14px] rounded-xl border border-[#e6e1ee] bg-white p-5";
export const CARD_TITLE = "text-base font-semibold leading-[normal] text-[#1f1a2e]";
export const CARD_LINK =
  "flex justify-center rounded-lg bg-[#efe6f8] px-3 py-2 text-sm font-medium leading-[normal] text-[#5b2a86]";

export function TicketDetailView({
  ticket,
  viewerId,
  viewerName = viewerId,
  canOpenOrder = false,
  canReassign = false,
  canNote = false,
  reassignments = [],
  escalations = [],
  suggestion = null,
  assistantChat,
}: {
  ticket: TicketDetail;
  assistantChat?: ReactNode;
  viewerId: string;
  viewerName?: string;
  /** Staff who hold the Orders, Payments or Fulfilment Module open the Order detail page from the Linked order. */
  canOpenOrder?: boolean;
  /** Only a CREOMS Manager can move the Ticket; Admin and CEO read the history below. */
  canReassign?: boolean;
  /** Staff and Managers may add Internal notes on any Ticket; Admin and CEO only read them. */
  canNote?: boolean;
  /** Every move of this Ticket, newest first. */
  reassignments?: ReassignmentRecord[];
  /** Every escalation of this Ticket, newest first; the one with no resolution is open. */
  escalations?: EscalationRecord[];
  /** The newest AI suggestion for this Ticket, if Staff asked for one. */
  suggestion?: SerializedSuggestion | null;
}) {
  const { order, customer } = ticket;
  // Until both sides have spoken there is no chat history to read, only what the Ticket was opened with.
  const activity = activityOf(reassignments, escalations);
  // A note is not an exchange with the Customer, but it still needs the chat layout to show up in.
  const hasExchange =
    new Set(ticket.messages.filter((m) => !m.internal).map((m) => m.sender)).size > 1 ||
    canNote ||
    ticket.messages.some((m) => m.internal);

  return (
    <ClaimProvider
      ticketId={ticket.id}
      claimer={ticket.claimerId !== null ? { id: ticket.claimerId, name: ticket.claimerName ?? "" } : null}
      viewer={{ id: viewerId, name: viewerName }}
      escalation={(() => {
        const open = escalations.find((e) => e.resolution === null);

        return open ? { reason: open.reason, note: open.note, byName: open.escalatedByName, at: open.at.toISOString() } : null;
      })()}
    >
    <HoldProvider ticketId={ticket.id} status={ticket.status} hold={ticket.hold}>
    <NotesProvider ticketId={ticket.id} viewerName={viewerName}>
    <div className="flex flex-col gap-5 px-8 py-7 lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      <div className="shrink-0 self-start"><BackButton fallbackHref="/tickets" label="Tickets" /></div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">
              TKT-{ticket.id} · {ticket.subject}
            </h1>
            <StatusPill />
            <EscalatedPill />
          </div>
          <p className="text-sm leading-[normal] text-[#6e6680]">
            Opened {formatDate(ticket.openedAt)} ·{" "}
            <ByClaimer
              mine={<>Claimed by <ClaimerName /></>}
              theirs={<>Claimed by <ClaimerName /></>}
              nobody="Unclaimed"
            />{" "}
            ·{" "}
            {PRIORITY_LABELS[ticket.priority]} priority
          </p>
        </div>
        <TicketActions
          ticketId={ticket.id}
          withReply={false}
          canReassign={canReassign}
          canEscalate
        />
      </div>

      <ServiceLevelPanel level={ticket.serviceLevel} />

      <div className="flex flex-col items-start gap-4 lg:min-h-0 lg:w-full lg:flex-1 lg:flex-row">
        <section
          aria-label="Conversation"
          className={cn(CARD, "flex h-[60vh] min-h-0 w-full min-w-0 flex-col space-y-0 gap-3 lg:h-full lg:flex-1")}
        >
          <SummaryCard key={ticket.id} ticketId={ticket.id} />
          <h2 className={CARD_TITLE}>Conversation</h2>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
            {assistantChat}
            {ticket.messages.length === 0 && !canNote ? (
              <p className="text-sm leading-[normal] text-[#6e6680]">No Messages yet.</p>
            ) : hasExchange ? (
              <Bubbles messages={ticket.messages} />
            ) : (
              <Attachments messages={ticket.messages} />
            )}
          </div>
          {canNote && <NoteBox />}
          {ticket.status !== "completed" && (
            <ByClaimer
              mine={
                <Link href={`/conversations?ticket=${ticket.id}`} className={CARD_LINK}>
                  Chat
                </Link>
              }
              theirs={
                <p className="text-sm leading-[normal] text-[#6e6680]">
                  <ClaimerName /> claimed this Ticket, so only they can chat.
                </p>
              }
              nobody={
                <p className="text-sm leading-[normal] text-[#6e6680]">Claim this Ticket to chat with the Customer.</p>
              }
            />
          )}
        </section>

        <div className="w-full space-y-4 lg:h-full lg:w-[380px] lg:shrink-0 lg:overflow-y-auto">
          <SuggestCard
            ticketId={ticket.id}
            category={ticket.category}
            priority={ticket.priority}
            suggestion={suggestion}
            canWork={canNote}
            completed={ticket.status === "completed"}
          />
          <HoldSummary />
          <EscalationSummary />
          {activity.length > 0 && (
            <section aria-label="Activity" className={CARD}>
              <h2 className={CARD_TITLE}>Activity</h2>
              <ul className="space-y-3">
                {activity.map((a) => (
                  <li key={a.key} className="space-y-0.5 text-[13px] leading-[normal] text-[#1f1a2e]">
                    <p>{a.text}</p>
                    {a.detail && <p className="text-[#6e6680]">{a.detail}</p>}
                    <p className="text-xs text-[#6e6680]">{formatDate(a.at)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {ticket.rating && (
            <section aria-label="Customer rating" className={CARD}>
              <h2 className={CARD_TITLE}>Customer rating</h2>
              {ticket.rating.stars !== null && (
                <p className="text-base font-medium leading-[normal] text-[#1f1a2e]">
                  <span aria-hidden>{"★".repeat(ticket.rating.stars)}{"☆".repeat(5 - ticket.rating.stars)}</span>{" "}
                  {ticket.rating.stars} out of 5
                </p>
              )}
              {ticket.rating.comment && (
                <p className="text-[13px] leading-[normal] break-words whitespace-pre-wrap text-[#1f1a2e]">
                  “{ticket.rating.comment}”
                </p>
              )}
              <p className="text-xs leading-[normal] text-[#6e6680]">Given {formatDate(ticket.rating.at)}</p>
            </section>
          )}
          {(ticket.followUpOf || ticket.followUps.length > 0) && (
            <section aria-label="Related tickets" className={CARD}>
              <h2 className={CARD_TITLE}>Related tickets</h2>
              <ul className="space-y-2">
                {ticket.followUpOf && (
                  <li className="text-[13px] leading-[normal] text-[#1f1a2e]">
                    Follow-up of{" "}
                    <Link href={`/tickets/${ticket.followUpOf.id}`} className="font-medium text-[#5b2a86] underline">
                      TKT-{ticket.followUpOf.id}
                    </Link>{" "}
                    · {ticket.followUpOf.subject}
                  </li>
                )}
                {ticket.followUps.map((f) => (
                  <li key={f.id} className="text-[13px] leading-[normal] text-[#1f1a2e]">
                    Follow-up:{" "}
                    <Link href={`/tickets/${f.id}`} className="font-medium text-[#5b2a86] underline">
                      TKT-{f.id}
                    </Link>{" "}
                    · {f.subject}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {order && (
            <section aria-label="Linked order" className={CARD}>
              <h2 className={CARD_TITLE}>Linked order</h2>
              <p className="text-base font-medium leading-[normal] text-[#1f1a2e]">
                #{order.id} · {formatWholePesos(order.total)}
              </p>
              <div className="flex gap-1.5">
                <Pill className={PAYMENT_PILLS[paymentStatusOf(order.status)]}>
                  {paymentStatusOf(order.status)}
                </Pill>
                <Pill className={ORDER_PILLS[order.status] ?? PILL.grey}>{orderLabel(order.status)}</Pill>
              </div>
              <p className="text-[13px] leading-[normal] text-[#6e6680]">
                {order.lines.map((l) => `${l.product} ×${l.quantity}`).join(", ")}
              </p>
              {(canOpenOrder || !customer.deleted) && (
                <Link href={canOpenOrder ? `/orders/${order.id}` : `/customer-profiles/${customer.id}#${orderAnchor(order.id)}`} className={CARD_LINK}>
                  Open order →
                </Link>
              )}
            </section>
          )}

          <section aria-label="Customer" className={CARD}>
            <div className="flex items-center gap-2">
              <h2 className={cn(CARD_TITLE, "flex-1")}>Customer</h2>
              <Pill className={STAGE_PILLS[customer.stage]}>{STAGE_LABELS[customer.stage]}</Pill>
            </div>
            <p data-testid={customer.deleted ? "deleted-customer-tag" : undefined} className="text-[13px] leading-[normal] text-[#6e6680]">
              {customer.name} · {customer.orders} {customer.orders === 1 ? "order" : "orders"} ·{" "}
              {formatWholePesos(customer.totalSpent)}
            </p>
            {!customer.deleted && (
              <Link href={`/customer-profiles/${customer.id}`} className={CARD_LINK}>
                View customer profile →
              </Link>
            )}
          </section>
        </div>
      </div>
    </div>
    </NotesProvider>
    </HoldProvider>
    </ClaimProvider>
  );
}

/** What the Ticket was opened with, shown in place of a chat while nobody has answered: the text and any image. */
function Attachments({ messages }: { messages: TicketMessage[] }) {
  return (
    <>
      {messages.map((m) => (
        <div key={m.id} className="space-y-2">
          {m.body && (
            <p className="text-sm leading-[normal] break-words whitespace-pre-wrap text-[#1f1a2e]">{m.body}</p>
          )}
          <MessageAttachment message={m} imageClassName="max-h-96 max-w-full rounded-lg object-contain" />
        </div>
      ))}
    </>
  );
}

interface ActivityItem {
  key: string;
  at: Date;
  text: string;
  detail?: string;
}

/** The Ticket's activity from CREOMS's own history, newest first: moves and escalations with what each Manager did. */
function activityOf(reassignments: ReassignmentRecord[], escalations: EscalationRecord[]): ActivityItem[] {
  const items: ActivityItem[] = reassignments.map((r) => ({
    key: `move-${r.id}`,
    at: r.at,
    text: `${r.movedByName} moved this Ticket from ${r.fromName} to ${r.toName}`,
    detail: `Reason: ${r.reason}`,
  }));

  for (const e of escalations) {
    items.push({
      key: `escalated-${e.id}`,
      at: e.at,
      text: `${e.escalatedByName} escalated this Ticket: ${escalationReasonLabel(e.reason)}`,
      detail: `Note: ${e.note}`,
    });
    if (e.resolution && e.resolvedAt)
      items.push({
        key: `resolved-${e.id}`,
        at: e.resolvedAt,
        text:
          e.resolution === "taken"
            ? `${e.resolvedByName} took this Ticket after the escalation`
            : `${e.resolvedByName} sent this Ticket back to its Claimer`,
        detail: e.resolutionNote ? `Note: ${e.resolutionNote}` : undefined,
      });
  }

  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}
