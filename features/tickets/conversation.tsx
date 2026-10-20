"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { formatDate } from "@/features/customer-profiles/format";

import { notifyOffline } from "./actions";
import type { ConnectLive, LiveConnection, LiveEvent } from "./live";
import { connectLive } from "./live-socket";
import type { TicketMessage } from "./ticket";
import { Composer } from "./ticket-controls";

const TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
});

const RECONNECT_MS = 3_000;

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

/**
 * The Ticket's Messages, kept current without a refresh. The database is the source of truth: the
 * page's saved Messages always show, and live ones are added to them, matched by id so a Message
 * that is both live and later reloaded shows once. A relay that fails loses nothing.
 */
export function Conversation({
  ticketId,
  messages,
  viewerName,
  customerName,
  note,
  canReply,
  connect = connectLive,
}: {
  ticketId: number;
  messages: TicketMessage[];
  viewerName: string;
  customerName: string;
  /** Why the Staff member cannot reply, when they cannot. */
  note: string | null;
  canReply: boolean;
  connect?: ConnectLive;
}) {
  const router = useRouter();
  const [live, setLive] = useState<TicketMessage[]>([]);
  const line = useRef<LiveConnection | null>(null);
  const refresh = useRef(router.refresh);
  /** Ids of replies relayed from here and not yet accounted for; each gets at most one Notification. */
  const awaiting = useRef(new Set<string>());

  useEffect(() => {
    refresh.current = router.refresh;
  });

  const shown = useMemo(() => {
    const saved = new Set(messages.map((m) => m.id));

    return [...messages, ...live.filter((m) => !saved.has(m.id))];
  }, [messages, live]);

  const add = useCallback((message: TicketMessage) => {
    setLive((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]));
  }, []);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let wasDown = false;

    const tellOffline = (id: string) => {
      if (awaiting.current.delete(id)) void notifyOffline(ticketId);
    };

    const open = () => {
      line.current = connect(ticketId, {
        // Anything relayed while the line was down is gone, so a reconnect reloads the saved Messages.
        onOpen: () => {
          if (wasDown) refresh.current();
          wasDown = false;
        },
        onEvent: (event: LiveEvent) => {
          // Nobody else was connected to receive the reply, or the relay refused it: tell the Customer.
          if (event.type === "message.delivered" && event.delivered === 0) tellOffline(event.id);
          if (event.type === "error" && event.id) tellOffline(event.id);
          if (event.type === "message.delivered" && event.delivered > 0) awaiting.current.delete(event.id);
          if (event.type !== "message") return;

          const id = Number(event.id);
          if (!Number.isInteger(id)) return;

          add({
            id,
            sender: event.from.role === "Customer" ? "customer" : "staff",
            senderName: event.from.role === "Customer" ? customerName : viewerName,
            body: event.text,
            hasAttachment: false,
            createdAt: new Date(event.sentAt),
          });
          // A Customer Message can reopen a Resolved Ticket, which the header shows.
          if (event.from.role === "Customer") refresh.current();
        },
        onClose: () => {
          line.current = null;
          wasDown = true;
          if (!stopped) retry = setTimeout(open, RECONNECT_MS);
        },
      });
    };

    open();

    return () => {
      stopped = true;
      clearTimeout(retry);
      line.current?.close();
      line.current = null;
    };
  }, [ticketId, connect, add, customerName, viewerName]);

  /** After a reply is saved: show it, relay it, and tell an offline Customer. */
  const sent = (message: { id: number; body: string }) => {
    add({
      id: message.id,
      sender: "staff",
      senderName: viewerName,
      body: message.body,
      hasAttachment: false,
      createdAt: new Date(),
    });

    const id = String(message.id);

    try {
      if (!line.current) throw new Error("The live line is not open");

      awaiting.current.add(id);
      line.current.send({ type: "message", id, text: message.body });
    } catch {
      // Saved but not relayed: the Customer sees it on reload, and is told it is waiting.
      awaiting.current.delete(id);
      void notifyOffline(ticketId);
    }
  };

  return (
    <>
      {shown.map((message, i) => {
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
              <p className="text-[11px] leading-[normal] text-[#6e6680]">{byline(message, shown[i - 1])}</p>
            </div>
          </div>
        );
      })}
      {canReply ? (
        <Composer ticketId={ticketId} onSent={sent} />
      ) : (
        <p className="text-sm leading-[normal] text-[#6e6680]">{note}</p>
      )}
    </>
  );
}
