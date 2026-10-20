"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import type { TicketStatus } from "./tickets";
import { claim, release, reply, resolve, type ReplyOutcome, type TicketActionOutcome } from "./actions";

const REASONS: Record<Exclude<TicketActionOutcome | ReplyOutcome, { ok: true }>["reason"], string> = {
  "not-found": "This Ticket no longer exists.",
  claimed: "Another Staff member has already claimed this Ticket.",
  "not-claimer": "Only the Staff member who claimed a Ticket can release it.",
  "not-claimed": "This Ticket is no longer claimed by you.",
  completed: "The Customer has completed this Ticket, so it can no longer change.",
  "already-resolved": "This Ticket is already resolved.",
  "empty-message": "Write a reply first.",
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

export function TicketActions({
  ticketId,
  status,
  claimed,
  isClaimer,
}: {
  ticketId: number;
  status: TicketStatus;
  claimed: boolean;
  isClaimer: boolean;
}) {
  const { pending, run } = useTicketAction();

  return (
    <div className="flex shrink-0 items-center gap-2">
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
                else toast.success("Marked resolved. The Customer has been asked to confirm.");
              },
            )
          }
        >
          Mark resolved
        </button>
      )}
      {status !== "completed" && (!claimed || isClaimer) && (
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
  const { pending, run } = useTicketAction();

  const send = () => {
    if (pending || !text.trim()) return;

    run(
      () => reply(ticketId, text),
      (r) => {
        if (!r.ok) return;

        setText("");
        if ("messageId" in r) onSent?.({ id: r.messageId, body: text.trim() });
      },
    );
  };

  return (
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
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
        className="max-h-40 min-w-0 flex-1 resize-none bg-transparent text-sm leading-[normal] text-[#1f1a2e] outline-none placeholder:text-[#9a93a8]"
      />
      <button type="button" className={PRIMARY} disabled={pending || !text.trim()} onClick={send}>
        Send
      </button>
    </div>
  );
}
