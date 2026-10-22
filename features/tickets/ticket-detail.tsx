import Link from "next/link";

import { formatDate, formatWholePesos } from "@/features/customer-profiles/format";
import { orderAnchor } from "@/features/customer-profiles/orders";
import { orderLabel, paymentStatusOf, STAGE_LABELS, type Stage } from "@/features/customer-profiles/rules";
import { cn } from "@/lib/utils";

import { PILL, Pill, PRIORITY_LABELS } from "./pill";
import { Bubbles } from "./conversation";
import { ByClaimer, ClaimerName, ClaimProvider } from "./claim";
import { TicketActions } from "./ticket-controls";
import type { TicketDetail, TicketMessage } from "./ticket";
import type { TicketStatus } from "./tickets";

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  completed: "Completed",
};

export const STATUS_PILLS: Record<TicketStatus, string> = {
  open: PILL.red,
  resolved: PILL.green,
  completed: PILL.green,
};

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
}: {
  ticket: TicketDetail;
  viewerId: string;
  viewerName?: string;
}) {
  const { order, customer } = ticket;
  // Until both sides have spoken there is no chat history to read, only what the Ticket was opened with.
  const hasExchange = new Set(ticket.messages.map((m) => m.sender)).size > 1;

  return (
    <ClaimProvider
      ticketId={ticket.id}
      claimer={ticket.claimerId !== null ? { id: ticket.claimerId, name: ticket.claimerName ?? "" } : null}
      viewer={{ id: viewerId, name: viewerName }}
    >
    <div className="flex flex-col gap-5 px-8 py-7 lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">
              TKT-{ticket.id} · {ticket.subject}
            </h1>
            <Pill className={STATUS_PILLS[ticket.status]}>{STATUS_LABELS[ticket.status]}</Pill>
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
          status={ticket.status}
          withReply={false}
        />
      </div>

      <div className="flex flex-col items-start gap-4 lg:min-h-0 lg:w-full lg:flex-1 lg:flex-row">
        <section
          aria-label="Conversation"
          className={cn(CARD, "flex h-[60vh] min-h-0 w-full min-w-0 flex-col space-y-0 gap-3 lg:h-full lg:flex-1")}
        >
          <h2 className={CARD_TITLE}>Conversation</h2>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
            {ticket.messages.length === 0 ? (
              <p className="text-sm leading-[normal] text-[#6e6680]">No Messages yet.</p>
            ) : hasExchange ? (
              <Bubbles messages={ticket.messages} />
            ) : (
              <Attachments messages={ticket.messages} />
            )}
          </div>
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
              <Link href={`/customer-profiles/${customer.id}#${orderAnchor(order.id)}`} className={CARD_LINK}>
                Open order →
              </Link>
            </section>
          )}

          <section aria-label="Customer" className={CARD}>
            <div className="flex items-center gap-2">
              <h2 className={cn(CARD_TITLE, "flex-1")}>Customer</h2>
              <Pill className={STAGE_PILLS[customer.stage]}>{STAGE_LABELS[customer.stage]}</Pill>
            </div>
            <p className="text-[13px] leading-[normal] text-[#6e6680]">
              {customer.name} · {customer.orders} {customer.orders === 1 ? "order" : "orders"} ·{" "}
              {formatWholePesos(customer.totalSpent)}
            </p>
            <Link href={`/customer-profiles/${customer.id}`} className={CARD_LINK}>
              View customer profile →
            </Link>
          </section>
        </div>
      </div>
    </div>
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
          {m.attachmentUrl ? (
            <a href={m.attachmentUrl} target="_blank" rel="noreferrer" className="block">
              {/* A short-lived signed address from file-storage, so next/image's optimizer cannot cache it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.attachmentUrl}
                alt={`Image attached by ${m.senderName}`}
                className="max-h-96 max-w-full rounded-lg object-contain"
              />
            </a>
          ) : (
            m.hasAttachment && <p className="text-xs leading-[normal] font-medium text-[#5b2a86]">Photo attached</p>
          )}
        </div>
      ))}
    </>
  );
}
