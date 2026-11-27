"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { formatDate } from "@/features/customer-profiles/format";

import type { ConnectLive, LiveConnection, LiveEvent } from "./live";
import { connectLive } from "./live-socket";
import { ImageViewer, type ViewerImage } from "./image-viewer";
import { MessageAttachment } from "./message-attachment";
import type { TicketMessage } from "./ticket";
import { NoteBox, Sending, useMessagesWithNotes } from "./notes";
import { Composer } from "./ticket-controls";
import { reply as replyAction } from "./actions";
import { refusalMessage } from "./refusals";
import { toast } from "sonner";
import { DraftPanel } from "./draft-panel";

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

/** Messages as chat bubbles, Customer on the left and Staff on the right. */
export function Bubbles({ messages: saved, chat = false }: { messages: TicketMessage[]; /** The Conversations look: our replies in solid purple, the Customer's in white. */ chat?: boolean }) {
  const messages = useMessagesWithNotes(saved);
  const [viewing, setViewing] = useState<number | null>(null);

  // Every image in the chat, so the viewer can step through them.
  const images: ViewerImage[] = messages.flatMap((m) =>
    chat && m.attachmentUrl && !m.attachmentType?.startsWith("video/") && m.attachmentType !== "application/pdf"
      ? [
          {
            id: m.id,
            url: m.attachmentUrl,
            name: m.attachmentName ?? null,
            size: m.attachmentSize ?? null,
            senderName: m.senderName,
            sentAt: `${formatDate(m.createdAt)}, ${TIME.format(m.createdAt)}`,
            caption: m.body,
          },
        ]
      : [],
  );

  return (
    <>
      {messages.map((message, i) => {
        const fromStaff = message.sender === "staff";

        if (message.internal)
          return (
            <div key={message.id} className="flex justify-end">
              <div
                data-internal-note
                className="flex w-[460px] max-w-full flex-col gap-1 rounded-xl border border-dashed border-[#e0c97a] bg-[#fff8e1] px-[14px] py-[10px]"
              >
                <p className="text-[13px] leading-[normal] font-semibold tracking-wide text-[#7a5b00] uppercase">
                  Internal note · only Staff see this
                </p>
                <p className="text-base leading-[normal] break-words whitespace-pre-wrap text-[#1f1a2e]">{message.body}</p>
                <p className="text-[13px] leading-[normal] text-[#7a5b00]">
                  {message.sending ? (
                    <>
                      {message.senderName} · <Sending />
                    </>
                  ) : (
                    byline(message, messages[i - 1])
                  )}
                </p>
              </div>
            </div>
          );

        return (
          <div key={message.id} className={cn("flex", fromStaff && "justify-end")}>
            <div
              className={cn(
                "flex w-[460px] max-w-full flex-col gap-1 rounded-xl px-[14px] py-[10px]",
                chat
                  ? fromStaff
                    ? "bg-[#5b2a86] text-white"
                    : "border border-[#e6e1ee] bg-white"
                  : fromStaff
                    ? "bg-[#efe6f8]"
                    : "bg-[#f3f1f6]",
              )}
            >
              {message.body && (
                <p className={cn("text-base leading-[normal] break-words whitespace-pre-wrap", chat && fromStaff ? "text-white" : "text-[#1f1a2e]")}>
                  {message.body}
                </p>
              )}
              <MessageAttachment
                message={message}
                imageClassName="max-h-64 max-w-full rounded-lg object-contain"
                onOpenImage={
                  chat
                    ? () => {
                        const at = images.findIndex((img) => img.id === message.id);
                        if (at >= 0) setViewing(at);
                      }
                    : undefined
                }
              />
              <p className={cn("text-[13px] leading-[normal]", chat && fromStaff ? "text-white/80" : "text-[#6e6680]")}>
                {byline(message, messages[i - 1])}
              </p>
            </div>
          </div>
        );
      })}
      {viewing !== null && <ImageViewer images={images} start={viewing} onClose={() => setViewing(null)} />}
    </>
  );
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
  canNote = false,
  draftDisabledReason,
  scrollable = false,
  readOnly = false,
  connect = connectLive,
}: {
  ticketId: number;
  messages: TicketMessage[];
  viewerName: string;
  customerName: string;
  /** Why the Staff member cannot reply, when they cannot. */
  note: string | null;
  canReply: boolean;
  /** Any Staff member may add an Internal note, claimer or not; the page must hold a NotesProvider. */
  canNote?: boolean;
  /** Staff and Managers get the draft panel; undefined (Admin) shows none. Null means on, a string is why it is off. */
  draftDisabledReason?: string | null;
  /** Fill the parent's height: the Messages scroll inside it and the reply box stays in view. */
  scrollable?: boolean;
  /** Admin read the chat and never reply, write notes or run AI: the box gives way to a one-line reason. */
  readOnly?: boolean;
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

  const [reply, setReply] = useState("");
  const [draftId, setDraftId] = useState<number | null>(null);

  const [mode, setMode] = useState<"reply" | "note" | "ai">("reply");

  /** Send an AI suggestion as the reply. Saved first, then shown and relayed; a refusal says why. */
  const sendDraft = async (text: string, id: number) => {
    try {
      const form = new FormData();
      form.set("body", text);
      form.set("draftId", String(id));
      const result = await replyAction(ticketId, form);
      if (!result.ok) {
        toast.error(refusalMessage(result));
        return;
      }
      if ("messageId" in result) sent({ id: result.messageId, body: text.trim() });
      router.refresh();
      setMode("reply");
    } catch (error) {
      console.error("Drafted reply could not be sent", error);
      toast.error("Could not send the reply. Please try again.");
    }
  };

  const draftPanel = draftDisabledReason !== undefined && (
    <DraftPanel
      ticketId={ticketId}
      disabledReason={draftDisabledReason}
      replyText={reply}
      canSend={canReply}
      onSend={sendDraft}
      onUse={(text, id) => { setReply(text); setDraftId(id); setMode("reply"); }}
    />
  );
  const bubbles = <Bubbles messages={shown} chat={scrollable} />;

  const replyArea = (
    <>
      {!scrollable && draftPanel}
      {canReply ? (
        <Composer ticketId={ticketId} onSent={sent} value={reply} onValueChange={setReply} draftId={draftId} onDraftSent={() => setDraftId(null)} />
      ) : (
        <p className="text-sm leading-[normal] text-[#6e6680]">{note}</p>
      )}
    </>
  );

  const tabs = (["reply", ...(canNote ? ["note"] : []), ...(draftDisabledReason !== undefined ? ["ai"] : [])]) as ("reply" | "note" | "ai")[];

  const footer = (
    <>
      {replyArea}
      {canNote && <NoteBox />}
    </>
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-[#faf9fc] p-3">
        {bubbles}
      </div>
      {readOnly ? (
        <p className="flex shrink-0 items-center gap-1.5 border-t border-[#e6e1ee] bg-white px-3 py-2 text-[13px] leading-[normal] text-[#6e6680]">
          <Lock aria-hidden className="size-3" />
          Read-only · Admin can read chats but never reply or run AI.
        </p>
      ) : (
      <div className="flex flex-col gap-3 border-t border-[#e6e1ee] bg-white px-3 pt-2 pb-3">
        {tabs.length > 1 && (
          <div role="tablist" aria-label="Reply, note or AI suggestion" className="flex gap-4 border-b border-[#e6e1ee]">
            {tabs.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "-mb-px border-b-2 pb-2 text-[15px] font-medium leading-[normal]",
                  mode === m ? "border-[#5b2a86] text-[#5b2a86]" : "border-transparent text-[#6e6680]",
                )}
              >
                {m === "reply" ? "Reply" : m === "note" ? "Internal note" : "AI suggestion"}
              </button>
            ))}
          </div>
        )}
        {mode === "note" && canNote ? <NoteBox inline /> : mode === "ai" && draftPanel ? draftPanel : replyArea}
        {mode === "reply" && (
          <p className="text-[13px] leading-[normal] text-[#6e6680]">
            Only the claimer can reply. Nothing sends until you press Send. Images: JPG or PNG up to 5 MB.
          </p>
        )}
      </div>
      )}
    </div>
  );
}
