"use client";

import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { useHold } from "./hold";
import { HOLD_MESSAGE_MAX, HOLD_NOTE_MAX, HOLD_REASONS, type HoldReason } from "./tickets";

const OUTLINE =
  "rounded-lg border border-[#e6e1ee] bg-white px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-[#1f1a2e] disabled:opacity-50";
const PRIMARY =
  "rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-white disabled:opacity-50";
const FIELD = "w-full rounded-lg border border-[#e6e1ee] bg-white px-3 py-2 text-sm leading-[normal] text-[#1f1a2e]";

/** A local date and time as the input wants it ("2026-11-16T18:00"). */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Put on hold: the Claimer's reason, an optional Staff-only note, when it returns to Open, and an optional Message they send themselves. */
export function HoldDialog({ ticketId }: { ticketId: number }) {
  const { putOnHold, pending } = useHold();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<HoldReason>("courier");
  const [note, setNote] = useState("");
  const [until, setUntil] = useState("");
  const [message, setMessage] = useState("");
  const [tried, setTried] = useState(false);

  const untilDate = until ? new Date(until) : null;
  const dateProblem = !untilDate || Number.isNaN(untilDate.getTime())
    ? "Choose when the Ticket returns to Open."
    : untilDate.getTime() <= Date.now()
      ? "Choose a date and time in the future."
      : null;

  const submit = () => {
    setTried(true);
    if (dateProblem) return;

    // The dialog closes and the page shows On hold at once; a refusal rolls it back with the reason.
    setOpen(false);
    putOnHold({ reason, note, until, message }, () => {
      setNote("");
      setMessage("");
      setUntil("");
      setTried(false);
    });
  };

  return (
    <>
      <button type="button" className={OUTLINE} disabled={pending} onClick={() => setOpen(true)}>
        Put on hold
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-[520px] gap-4 overflow-y-auto">
          <DialogTitle className="text-lg font-semibold text-[#1f1a2e]">Put TKT-{ticketId} on hold?</DialogTitle>
          <DialogDescription className="text-[13px] text-[#6e6680]">
            Use this when you&apos;re waiting on someone other than the customer. The customer sees &ldquo;We&apos;re on it&rdquo;, never the reason.
          </DialogDescription>

          <fieldset className="space-y-2 rounded-xl border border-[#e6e1ee] p-3">
            <legend className="px-1 text-[13px] font-medium text-[#1f1a2e]">Waiting on</legend>
            {HOLD_REASONS.map((r) => (
              <label
                key={r.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5",
                  reason === r.value ? "border-[#5b2a86] bg-[#f6f0fb]" : "border-[#e6e1ee]",
                )}
              >
                <input
                  type="radio"
                  name="hold-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="mt-1 accent-[#5b2a86]"
                />
                <span className="flex flex-col text-sm leading-[normal] text-[#1f1a2e]">
                  {r.label}
                  {r.hint && <span className="text-xs text-[#6e6680]">{r.hint}</span>}
                </span>
              </label>
            ))}
          </fieldset>

          <label className="space-y-1 text-[13px] font-medium text-[#1f1a2e]">
            Note (Staff only, optional)
            <textarea
              className={FIELD}
              rows={2}
              maxLength={HOLD_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <label className="space-y-1 text-[13px] font-medium text-[#1f1a2e]">
            Back to Open on
            <input
              type="datetime-local"
              className={FIELD}
              min={localInput(new Date())}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              aria-invalid={tried && !!dateProblem}
            />
            {tried && dateProblem && (
              <span role="alert" className="block text-xs font-normal text-[#9a3412]">
                {dateProblem}
              </span>
            )}
          </label>

          <label className="space-y-1 text-[13px] font-medium text-[#1f1a2e]">
            Message to the customer (optional)
            <textarea
              className={FIELD}
              rows={2}
              maxLength={HOLD_MESSAGE_MAX}
              placeholder="We're waiting on the rider and will update you."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <span className="block text-xs font-normal text-[#6e6680]">You send this yourself when you confirm. Leave it empty to send nothing.</span>
          </label>

          <p className="text-xs text-[#6e6680]">Waiting on the customer? Just reply; that status is automatic.</p>

          <div className="flex justify-end gap-2">
            <button type="button" className={OUTLINE} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className={PRIMARY} onClick={submit}>
              Put on hold
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
