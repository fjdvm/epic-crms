import Link from "next/link";

import { formatDate, formatWholePesos } from "@/features/customer-profiles/format";
import { orderAnchor } from "@/features/customer-profiles/orders";
import { orderLabel, paymentStatusOf, STAGE_LABELS, type Stage } from "@/features/customer-profiles/rules";
import { cn } from "@/lib/utils";

import { PILL, Pill, PRIORITY_LABELS } from "./pill";
import { Composer, TicketActions } from "./ticket-controls";
import type { TicketDetail, TicketMessage } from "./ticket";
import type { TicketStatus } from "./tickets";

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  completed: "Completed",
};

const STATUS_PILLS: Record<TicketStatus, string> = {
  open: PILL.red,
  resolved: PILL.green,
  completed: PILL.green,
};

const STAGE_PILLS: Record<Stage, string> = {
  new: PILL.blue,
  "first-order": PILL.blue,
  repeat: PILL.purple,
  "at-risk": PILL.amber,
  lost: PILL.grey,
};

const PAYMENT_PILLS = {
  Paid: PILL.green,
  Unpaid: PILL.amber,
  Cancelled: PILL.grey,
} as const;

const ORDER_PILLS: Record<string, string> = {
  dispatched: PILL.blue,
  delivered: PILL.green,
  cancelled: PILL.grey,
};

const TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
});

const sameDay = (a: Date, b: Date) => formatDate(a) === formatDate(b);

/** "Maria · 10:12 AM"; the date comes first when the Message is not from the day of the one before it. */
function byline(message: TicketMessage, previous: TicketMessage | undefined): string {
  const time = TIME.format(message.createdAt);
  const when =
    previous && !sameDay(previous.createdAt, message.createdAt)
      ? `${formatDate(message.createdAt)}, ${time}`
      : time;

  return `${message.senderName} · ${when}`;
}

const CARD = "space-y-[14px] rounded-xl border border-[#e6e1ee] bg-white p-5";
const CARD_TITLE = "text-base font-semibold leading-[normal] text-[#1f1a2e]";
const CARD_LINK =
  "flex justify-center rounded-lg bg-[#efe6f8] px-3 py-2 text-sm font-medium leading-[normal] text-[#5b2a86]";

export function TicketDetailView({ ticket, viewerId }: { ticket: TicketDetail; viewerId: string }) {
  const { order, customer } = ticket;
  const isClaimer = ticket.claimerId !== null && ticket.claimerId === viewerId;
  const claimedByOther = ticket.claimerId !== null && !isClaimer;

  return (
    <div className="space-y-5 px-8 py-7">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">
              TKT-{ticket.id} · {ticket.subject}
            </h1>
            <Pill className={STATUS_PILLS[ticket.status]}>{STATUS_LABELS[ticket.status]}</Pill>
          </div>
          <p className="text-sm leading-[normal] text-[#6e6680]">
            Opened {formatDate(ticket.openedAt)} ·{" "}
            {ticket.claimerName ? `Claimed by ${ticket.claimerName}` : "Unclaimed"} ·{" "}
            {PRIORITY_LABELS[ticket.priority]} priority
          </p>
        </div>
        <TicketActions
          ticketId={ticket.id}
          status={ticket.status}
          claimed={ticket.claimerId !== null}
          isClaimer={isClaimer}
        />
      </div>

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        <section aria-label="Conversation" className={cn(CARD, "w-full min-w-0 space-y-3 lg:flex-1")}>
          <h2 className={CARD_TITLE}>Conversation</h2>
          {ticket.messages.map((message, i) => {
            const fromStaff = message.sender === "staff";

            return (
              <div key={message.id} className={cn("flex", fromStaff && "justify-end")}>
                <div
                  className={cn(
                    "flex w-[460px] max-w-full flex-col gap-1 rounded-xl px-[14px] py-[10px]",
                    fromStaff ? "bg-[#efe6f8]" : "bg-[#f3f1f6]",
                  )}
                >
                  <p className="text-sm leading-[normal] break-words whitespace-pre-wrap text-[#1f1a2e]">
                    {message.body}
                  </p>
                  {message.hasAttachment && (
                    <p className="text-xs leading-[normal] font-medium text-[#5b2a86]">Photo attached</p>
                  )}
                  <p className="text-[11px] leading-[normal] text-[#6e6680]">
                    {byline(message, ticket.messages[i - 1])}
                  </p>
                </div>
              </div>
            );
          })}
          {ticket.status === "completed" ? (
            <p className="text-sm leading-[normal] text-[#6e6680]">
              The Customer completed this Ticket, so it can no longer be replied to.
            </p>
          ) : claimedByOther ? (
            <p className="text-sm leading-[normal] text-[#6e6680]">
              {ticket.claimerName} claimed this Ticket, so only they can reply.
            </p>
          ) : (
            <Composer ticketId={ticket.id} />
          )}
        </section>

        <div className="w-full space-y-4 lg:w-[380px] lg:shrink-0">
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
  );
}
