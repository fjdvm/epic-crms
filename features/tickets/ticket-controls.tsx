"use client";

import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { IMAGE_REFUSALS, MAX_IMAGE_BYTES } from "./attachments";
import type { TicketStatus } from "./tickets";
import {
  claim,
  release,
  reply,
  resolve,
  type ReplyOutcome,
  type TicketActionOutcome,
} from "./actions";

const REASONS: Record<
  Exclude<TicketActionOutcome | ReplyOutcome, { ok: true }>["reason"],
  string
> = {
  "not-found": "This Ticket no longer exists.",
  claimed: "Another Staff member has already claimed this Ticket.",
  "not-claimer": "Only the Staff member who claimed a Ticket can release it.",
  "not-claimed": "This Ticket is no longer claimed by you.",
  completed:
    "The Customer has completed this Ticket, so it can no longer change.",
  "already-resolved": "This Ticket is already resolved.",
  "empty-message": "Write a reply or attach an image first.",
  ...IMAGE_REFUSALS,
  "storage-unavailable":
    "CREOMS could not store that image. Try again in a moment.",
  unavailable: "CREOMS could not save that. Try again in a moment.",
};

const OUTLINE =
  "rounded-lg border border-[#e6e1ee] bg-white px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-[#1f1a2e] disabled:opacity-50";
const PRIMARY =
  "rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-white disabled:opacity-50";

/** Runs a Ticket action, then refreshes the page; a refusal is said out loud instead of swallowed. */
function useTicketAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = <R extends TicketActionOutcome | ReplyOutcome>(
    action: () => Promise<R>,
    onDone?: (r: R) => void,
  ) =>
    startTransition(async () => {
      const result = await action();

      if (!result.ok) toast.error(REASONS[result.reason]);
      else router.refresh();

      onDone?.(result);
    });

  return { pending, run };
}

/** Claim from the Tickets list; the Ticket then leaves the list for the Claimer's Conversations inbox. */
export function ClaimButton({ ticketId }: { ticketId: number }) {
  const { pending, run } = useTicketAction();

  return (
    <button type="button" className={OUTLINE} disabled={pending} onClick={() => run(() => claim(ticketId))}>
      Claim
    </button>
  );
}

export function TicketActions({
  ticketId,
  status,
  claimed,
  isClaimer,
  withReply = true,
  className,
}: {
  ticketId: number;
  status: TicketStatus;
  claimed: boolean;
  isClaimer: boolean;
  /** Offer the Reply link to the composer; off where the composer sits beside the actions. */
  withReply?: boolean;
  className?: string;
}) {
  const { pending, run } = useTicketAction();

  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      {status !== "completed" && !claimed && (
        <button
          type="button"
          className={OUTLINE}
          disabled={pending}
          onClick={() => run(() => claim(ticketId))}
        >
          Claim
        </button>
      )}
      {status !== "completed" && isClaimer && (
        <button
          type="button"
          className={OUTLINE}
          disabled={pending}
          onClick={() => run(() => release(ticketId))}
        >
          Release
        </button>
      )}
      {status === "open" && (
        <button
          type="button"
          className={OUTLINE}
          disabled={pending}
          onClick={() =>
            run(
              () => resolve(ticketId),
              (r) => {
                if (!r.ok) return;
                if ("emailed" in r && r.emailed === false)
                  toast.warning(
                    "Marked resolved, but the confirmation email could not be sent to the Customer.",
                  );
                else
                  toast.success(
                    "Marked resolved. The Customer has been asked to confirm.",
                  );
              },
            )
          }
        >
          Mark resolved
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

export function Composer({
  ticketId,
  onSent,
}: {
  ticketId: number;
  /** Called once the reply is saved, so it can be relayed live. */
  onSent?: (message: { id: number; body: string }) => void;
}) {
  const [text, setText] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const { pending, run } = useTicketAction();
  const [picked, setPicked] = useState<{ file: File; url?: string } | null>(
    null,
  );
  const image = picked?.file ?? null;
  const preview = picked?.url;

  // The preview address is made when the file is picked, not in an effect, so it survives Strict Mode remounts.
  const setImage = (file: File | null) =>
    setPicked((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);

      return file
        ? {
            file,
            url:
              typeof URL.createObjectURL === "function"
                ? URL.createObjectURL(file)
                : undefined,
          }
        : null;
    });

  const choose = (file: File | undefined) => {
    if (!file) return;

    // Said here as well as on the server, so a big file never travels just to be refused.
    if (!/^image\/(jpeg|png)$/.test(file.type))
      toast.error(IMAGE_REFUSALS["invalid-image-type"]);
    else if (file.size === 0) toast.error(IMAGE_REFUSALS["empty-image"]);
    else if (file.size > MAX_IMAGE_BYTES)
      toast.error(IMAGE_REFUSALS["image-too-large"]);
    else setImage(file);

    if (picker.current) picker.current.value = "";
  };

  const sending = useRef(false);

  const send = () => {
    if (sending.current || pending || (!text.trim() && !image)) return;
    sending.current = true;

    const form = new FormData();
    form.set("body", text);
    if (image) form.set("image", image);

    // The box clears as soon as the reply is on its way; a refused reply puts it back.
    const sentText = text;
    const sentImage = image;
    setText("");
    setImage(null);

    run(
      () => reply(ticketId, form),
      (r) => {
        sending.current = false;
        if (!r.ok) {
          setText((current) => current || sentText);
          if (sentImage) setImage(sentImage);
          return;
        }

        if ("messageId" in r)
          onSent?.({
            id: r.messageId,
            body: sentText.trim() || "Sent a photo",
          });
      },
    );
  };

  return (
    <div className="space-y-2">
      {image && (
        <div className="relative size-16">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the picked file
            <img
              src={preview}
              alt={`Selected image: ${image.name}`}
              className="size-16 rounded-lg object-cover"
            />
          ) : (
            <span className="flex size-16 items-center justify-center rounded-lg bg-[#f3f1f6] p-1 text-center text-[10px] leading-[normal] break-all text-[#5b2a86]">
              {image.name}
            </span>
          )}
          <button
            type="button"
            aria-label={`Remove ${image.name}`}
            className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border border-[#e6e1ee] bg-white text-[#1f1a2e] shadow"
            onClick={() => setImage(null)}
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
      <div
        className={cn(
          "flex items-center gap-2 rounded-[10px] border border-[#e6e1ee] bg-white py-1.5 pr-1.5 pl-[14px]",
        )}
      >
        <textarea
          id="reply"
          rows={1}
          aria-label="Write a reply"
          placeholder="Write a reply…"
          value={text}
          readOnly={pending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
          className="max-h-40 min-w-0 flex-1 resize-none bg-transparent text-sm leading-[normal] text-[#1f1a2e] outline-none placeholder:text-[#9a93a8]"
        />
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png"
          aria-label="Attach an image"
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
          Attach image
        </button>
        <button
          type="button"
          className={cn(PRIMARY, "inline-flex items-center gap-1.5")}
          disabled={pending || (!text.trim() && !image)}
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
