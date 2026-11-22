"use client";

import { FileText, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { useOptimisticAction } from "@/hooks/use-optimistic-action";

import { uploadFile } from "@/features/files/client";
import { checkFileInfo, FILE_TYPES, type FileContentType } from "@/features/files/policy";

import { claim, reply, type ReplyOutcome, type TicketActionOutcome } from "./actions";
import { useClaim } from "./claim";
import { refusalMessage } from "./refusals";
import { HoldDialog } from "./hold-dialog";
import { EscalateDialog, EscalationManagerButtons } from "./escalate-ui";
import { ReassignTicketDialog } from "./reassign-dialog";
import { useHold } from "./hold";

const OUTLINE =
  "rounded-lg border border-[#e6e1ee] bg-white px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-[#1f1a2e] disabled:opacity-50";
const PRIMARY =
  "rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-white disabled:opacity-50";

/** The file could not be attached, so no reply was sent; `message` says why, as the upload module worded it. */
type UploadRefused = { ok: false; reason: "upload-refused"; message: string };

/** Runs a Ticket action, then refreshes the page; a refusal is said out loud instead of swallowed. */
function useTicketAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = <R extends TicketActionOutcome | ReplyOutcome | UploadRefused>(
    action: () => Promise<R>,
    onDone?: (r: R) => void,
  ) =>
    startTransition(async () => {
      const result = await action();

      if (!result.ok) toast.error("message" in result ? result.message : refusalMessage(result));
      else router.refresh();

      onDone?.(result);
    });

  return { pending, run };
}

/** Claim from the Tickets list; the Ticket then leaves the list for the Claimer's Conversations inbox. */
export function ClaimButton({ ticketId }: { ticketId: number }) {
  const { state: claimed, pending, run } = useOptimisticAction(false);

  if (claimed)
    return <span className="text-sm leading-[normal] font-medium text-[#6e6680]">Claimed</span>;

  return (
    <button
      type="button"
      className={OUTLINE}
      disabled={pending}
      onClick={() => run(true, () => claim(ticketId, crypto.randomUUID()), { refusal: refusalMessage })}
    >
      Claim
    </button>
  );
}

export function TicketActions({
  ticketId,
  withReply = true,
  canReassign = false,
  canEscalate = false,
  className,
}: {
  ticketId: number;
  /** A CREOMS Manager sees Reassign, Take ticket and Send back; everyone else sees no button. */
  canReassign?: boolean;
  /** The Ticket page knows the escalation; the Conversations page does not offer Escalate. */
  canEscalate?: boolean;
  /** Offer the Reply link to the composer; off where the composer sits beside the actions. */
  withReply?: boolean;
  className?: string;
}) {
  const { claimer, isClaimer, escalation, pending: claiming, claim: claimTicket, release: releaseTicket } = useClaim();
  const claimed = claimer !== null;
  const { status, pending: holding, takeOffHold } = useHold();

  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      {status !== "completed" && !claimed && (
        <button
          type="button"
          className={OUTLINE}
          disabled={claiming}
          onClick={claimTicket}
        >
          Claim
        </button>
      )}
      {status !== "completed" && isClaimer && !escalation && (
        <button
          type="button"
          className={OUTLINE}
          disabled={claiming}
          onClick={releaseTicket}
        >
          Release
        </button>
      )}
      {status !== "completed" && canEscalate && isClaimer && !escalation && <EscalateDialog ticketId={ticketId} />}
      {status !== "completed" && canReassign && <EscalationManagerButtons ticketId={ticketId} />}
      {status !== "completed" && claimed && canReassign && <ReassignTicketDialog ticketId={ticketId} />}
      {status === "open" && isClaimer && <HoldDialog ticketId={ticketId} />}
      {status === "on_hold" && isClaimer && (
        <button type="button" className={OUTLINE} disabled={holding} onClick={takeOffHold}>
          Take off hold
        </button>
      )}
      {withReply && status !== "completed" && (!claimed || isClaimer) && (
        <a href="#reply" className={PRIMARY}>
          Reply
        </a>
      )}
    </div>
  );
}

const ACCEPT = FILE_TYPES.join(",");

export function Composer({
  ticketId,
  onSent,
  value,
  onValueChange,
  draftId = null,
  onDraftSent,
}: {
  ticketId: number;
  /** Called once the reply is saved, so it can be relayed live. */
  onSent?: (message: { id: number; body: string }) => void;
  /** Optional controlled reply text, so a Drafted reply can be put in the box. */
  value?: string;
  onValueChange?: (text: string) => void;
  /** The saved Drafted reply this text came from, so the send is recorded as drafted or edited. */
  draftId?: number | null;
  onDraftSent?: () => void;
}) {
  const [ownText, setOwnText] = useState("");
  const text = value ?? ownText;
  const setText = (next: string | ((current: string) => string)) => {
    const resolved = typeof next === "function" ? next(text) : next;
    setOwnText(resolved);
    onValueChange?.(resolved);
  };
  const picker = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const { pending, run } = useTicketAction();

  // The box grows with what is typed (up to its max height, then scrolls) and shrinks back when text is removed or sent.
  useLayoutEffect(() => {
    const box = area.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [text]);
  const [picked, setPicked] = useState<{ file: File; url?: string } | null>(
    null,
  );
  const file = picked?.file ?? null;
  const preview = picked?.url;

  // The preview address is made when the file is picked, not in an effect, so it survives Strict Mode remounts.
  const setFile = (next: File | null) =>
    setPicked((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);

      return next
        ? {
            file: next,
            url:
              next.type.startsWith("image/") && typeof URL.createObjectURL === "function"
                ? URL.createObjectURL(next)
                : undefined,
          }
        : null;
    });

  const choose = (next: File | undefined) => {
    if (!next) return;

    // Said here as well as by the upload module, so a big file never travels just to be refused.
    const refusal = checkFileInfo("Tickets", {
      filename: next.name,
      contentType: next.type as FileContentType,
      size: next.size,
    });

    if (refusal) toast.error(refusal);
    else setFile(next);

    if (picker.current) picker.current.value = "";
  };

  const sending = useRef(false);
  /** A file already uploaded for a reply that was then refused, so a retry does not store it again. */
  const uploaded = useRef<{ file: File; reference: string } | null>(null);

  const send = () => {
    if (sending.current || pending || (!text.trim() && !file)) return;
    sending.current = true;

    // The box clears as soon as the reply is on its way; a refused reply puts it back.
    const sentText = text;
    const sentFile = file;
    setText("");
    setFile(null);

    run(
      async () => {
        try {
          const form = new FormData();
          form.set("body", sentText);
          if (draftId !== null) form.set("draftId", String(draftId));

          if (sentFile) {
            if (uploaded.current?.file !== sentFile) {
              // Straight to file-storage; only the signed reference reaches the server action.
              const result = await uploadFile("Tickets", sentFile, { ticketId });
              if (!result.ok) return { ok: false as const, reason: "upload-refused" as const, message: result.reason };
              uploaded.current = { file: sentFile, reference: result.reference };
            }
            form.set("attachment", uploaded.current.reference);
          }

          const sent = await reply(ticketId, form);
          if (sent.ok) uploaded.current = null;

          return sent;
        } catch (error) {
          console.error("Reply could not be sent", error);

          return { ok: false as const, reason: "unavailable" as const };
        }
      },
      (r) => {
        sending.current = false;
        if (!r.ok) {
          setText((current) => current || sentText);
          if (sentFile) setFile(sentFile);
          return;
        }

        if ("messageId" in r) {
          onDraftSent?.();
          onSent?.({
            id: r.messageId,
            body: sentText.trim() || "Sent a file",
          });
        }
      },
    );
  };

  return (
    <div className="space-y-2">
      {file && (
        <div className="relative">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the picked file
            <img
              src={preview}
              alt={`Selected image: ${file.name}`}
              className="size-16 rounded-lg object-cover"
            />
          ) : (
            <span className="flex max-w-64 items-center gap-1.5 rounded-lg bg-[#f3f1f6] px-2.5 py-2 text-xs leading-[normal] break-all text-[#5b2a86]">
              <FileText aria-hidden className="size-4 shrink-0" />
              {file.name}
            </span>
          )}
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border border-[#e6e1ee] bg-white text-[#1f1a2e] shadow"
            onClick={() => setFile(null)}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
      <div
        className={cn(
          "flex items-end gap-2 rounded-[10px] border border-[#e6e1ee] bg-white py-1.5 pr-1.5 pl-[14px]",
        )}
      >
        <textarea
          id="reply"
          rows={1}
          ref={area}
          aria-label="Write a reply"
          placeholder="Write a reply…"
          value={text}
          readOnly={pending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !pending && (text.trim() || file)) send();
          }}
          className="my-1 max-h-40 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-sm leading-[normal] text-[#1f1a2e] outline-none placeholder:text-[#9a93a8]"
        />
        <input
          ref={picker}
          type="file"
          accept={ACCEPT}
          aria-label="Attach a file"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => choose(e.target.files?.[0])}
        />
        <button
          type="button"
          className={OUTLINE}
          disabled={pending}
          onClick={() => picker.current?.click()}
        >
          Attach file
        </button>
        <button
          type="button"
          className={cn(PRIMARY, "inline-flex items-center gap-1.5")}
          disabled={pending || (!text.trim() && !file)}
          aria-busy={pending}
          onClick={send}
        >
          {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
