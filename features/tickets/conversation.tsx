"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { formatDate } from "@/features/customer-profiles/format";

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
  scrollable = false,
  connect = connectLive,
}: {
  ticketId: number;
  messages: TicketMessage[];
  viewerName: string;
  customerName: string;
  /** Why the Staff member cannot reply, when they cannot. */
  note: string | null;
  canReply: boolean;
  /** Fill the parent's height: the Messages scroll inside it and the reply box stays in view. */
  scrollable?: boolean;
  connect?: ConnectLive;
}) {
  const router = useRouter();
  const [live, setLive] = useState<TicketMessage[]>([]);
  const line = useRef<LiveConnection | null>(null);
  const refresh = useRef(router.refresh);

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

    const open = () => {
      line.current = connect(ticketId, {
        // Anything relayed while the line was down is gone, so a reconnect reloads the saved Messages.
        onOpen: () => {
          if (wasDown) refresh.current();
          wasDown = false;
        },
        onEvent: (event: LiveEvent) => {
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

  /** After a reply is saved: show it and relay it. */
  const sent = (message: { id: number; body: string }) => {
    add({
      id: message.id,
      sender: "staff",
      senderName: viewerName,
      body: message.body,
      hasAttachment: false,
      createdAt: new Date(),
    });

    // Saved first; a line that is down or refuses the frame loses nothing, the Customer sees it on reload.
    try {
      line.current?.send({ type: "message", id: String(message.id), text: message.body });
    } catch (error) {
      console.error("Reply saved but could not be relayed live", error);
    }
  };

  const scroller = useRef<HTMLDivElement>(null);

  // Show the newest Message: on opening the chat, and whenever one arrives.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [shown.length]);

  const bubbles = shown.map((message, i) => {
        const fromStaff = message.sender === "staff";

        return (
          <div key={message.id} className={cn("flex", fromStaff && "justify-end")}>
            <div
              className={cn(
                "flex w-[460px] max-w-full flex-col gap-1 rounded-xl px-[14px] py-[10px]",
                fromStaff ? "bg-[#efe6f8]" : "bg-[#f3f1f6]",
              )}
            >
              {message.body && (
                <p className="text-sm leading-[normal] break-words whitespace-pre-wrap text-[#1f1a2e]">
                  {message.body}
                </p>
              )}
              {message.attachmentUrl ? (
                <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className="block">
                  {/* A short-lived signed address from file-storage, so next/image's optimizer cannot cache it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={message.attachmentUrl}
                    alt={`Image attached by ${message.senderName}`}
                    className="max-h-64 max-w-full rounded-lg object-contain"
                  />
                </a>
              ) : (
                message.hasAttachment && (
                  <p className="text-xs leading-[normal] font-medium text-[#5b2a86]">Photo attached</p>
                )
              )}
              <p className="text-[11px] leading-[normal] text-[#6e6680]">{byline(message, shown[i - 1])}</p>
            </div>
          </div>
        );
      });

  const footer = canReply ? (
    <Composer ticketId={ticketId} onSent={sent} />
  ) : (
    <p className="text-sm leading-[normal] text-[#6e6680]">{note}</p>
  );

  if (!scrollable) {
    return (
      <>
        {bubbles}
        {footer}
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {bubbles}
      </div>
      {footer}
    </div>
  );
}
