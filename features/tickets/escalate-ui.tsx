"use client";

import { useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/features/customer-profiles/format";
import { cn } from "@/lib/utils";

import { useClaim } from "./claim";
import { ESCALATION_NOTE_MAX, ESCALATION_REASONS, escalationReasonLabel, type EscalationReason } from "./escalate-reasons";
import { PILL, Pill } from "./pill";

const OUTLINE =
  "rounded-lg border border-[#e6e1ee] bg-white px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-[#1f1a2e] disabled:opacity-50";
const PRIMARY =
  "rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-white disabled:opacity-50";
const FIELD = "w-full rounded-lg border border-[#e6e1ee] bg-white px-3 py-2 text-sm leading-[normal] text-[#1f1a2e]";

/** The Escalated badge, shown to everyone while a Manager has been asked and has not acted. */
export function EscalatedPill() {
  const { escalation } = useClaim();

  return escalation ? <Pill className={PILL.red}>Escalated</Pill> : null;
}

/** The Claimer asks every Manager for help: one reason and a short note. Nothing else escalates. */
export function EscalateDialog({ ticketId }: { ticketId: number }) {
  const { escalate, pending } = useClaim();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<EscalationReason | null>(null);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);

  const submit = () => {
    setTried(true);
    if (!reason || !note.trim()) return;

    // The dialog closes and the page shows Escalated at once; a refusal rolls it back with the reason.
    setOpen(false);
    escalate(reason, note, () => {
      setReason(null);
      setNote("");
      setTried(false);
    });
  };

  return (
    <>
      <button type="button" className={OUTLINE} disabled={pending} onClick={() => setOpen(true)}>
        Escalate
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-[520px] gap-4 overflow-y-auto">
          <DialogTitle className="text-lg font-semibold text-[#1f1a2e]">Escalate TKT-{ticketId}?</DialogTitle>
          <DialogDescription className="text-[13px] text-[#6e6680]">
            Every Manager is alerted in CREOMS. You stay on the Ticket until a Manager takes it or sends it back. No email is sent.
          </DialogDescription>

          <fieldset className="space-y-2 rounded-xl border border-[#e6e1ee] p-3">
            <legend className="px-1 text-[13px] font-medium text-[#1f1a2e]">Why</legend>
            {ESCALATION_REASONS.map((r) => (
              <label
                key={r.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5",
                  reason === r.value ? "border-[#5b2a86] bg-[#f6f0fb]" : "border-[#e6e1ee]",
                )}
              >
                <input
                  type="radio"
                  name="escalation-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="accent-[#5b2a86]"
                />
                <span className="text-sm leading-[normal] text-[#1f1a2e]">{r.label}</span>
              </label>
            ))}
            {tried && !reason && (
              <span role="alert" className="block text-xs text-[#9a3412]">
                Choose why you are escalating.
              </span>
            )}
          </fieldset>

          <label className="block space-y-1 text-[13px] font-medium text-[#1f1a2e]">
            Note for the Manager
            <textarea
              className={FIELD}
              rows={3}
              maxLength={ESCALATION_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={tried && !note.trim()}
              placeholder="What do you need decided or done?"
            />
            {tried && !note.trim() && (
              <span role="alert" className="block text-xs font-normal text-[#9a3412]">
                Write a short note.
              </span>
            )}
          </label>

          <div className="flex justify-end gap-2">
            <button type="button" className={OUTLINE} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className={PRIMARY} onClick={submit}>
              Escalate
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Manager only: take the escalated Ticket (becoming its Claimer) or send it back with a note. */
export function EscalationManagerButtons({ ticketId }: { ticketId: number }) {
  const { escalation, take, sendBack, pending } = useClaim();
  const [taking, setTaking] = useState(false);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);

  if (!escalation) return null;

  const submit = () => {
    setTried(true);
    if (!note.trim()) return;
    setSending(false);
    sendBack(note, () => {
      setNote("");
      setTried(false);
    });
  };

  return (
    <>
      <button type="button" className={PRIMARY} disabled={pending} onClick={() => setTaking(true)}>
        Take ticket
      </button>
      <button type="button" className={OUTLINE} disabled={pending} onClick={() => setSending(true)}>
        Send back
      </button>

      <AlertDialog open={taking} onOpenChange={setTaking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take TKT-{ticketId}?</AlertDialogTitle>
            <AlertDialogDescription>
              You become its Claimer and the current Claimer is told. The escalation is closed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <button
              type="button"
              className={PRIMARY}
              onClick={() => {
                setTaking(false);
                take();
              }}
            >
              Take ticket
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={sending} onOpenChange={setSending}>
        <DialogContent className="max-w-[480px] gap-4">
          <DialogTitle className="text-lg font-semibold text-[#1f1a2e]">Send TKT-{ticketId} back?</DialogTitle>
          <DialogDescription className="text-[13px] text-[#6e6680]">
            The Claimer stays on the Ticket and is told your note.
          </DialogDescription>
          <label className="block space-y-1 text-[13px] font-medium text-[#1f1a2e]">
            Note
            <textarea
              className={FIELD}
              rows={3}
              maxLength={ESCALATION_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={tried && !note.trim()}
            />
            {tried && !note.trim() && (
              <span role="alert" className="block text-xs font-normal text-[#9a3412]">
                Write a note.
              </span>
            )}
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={OUTLINE} onClick={() => setSending(false)}>
              Cancel
            </button>
            <button type="button" className={PRIMARY} onClick={submit}>
              Send back
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Why a Manager has been asked, for anyone looking at the Ticket. */
export function EscalationSummary() {
  const { escalation } = useClaim();
  if (!escalation) return null;

  return (
    <section aria-label="Escalated" className="space-y-1.5 rounded-xl border border-[#f0c9c9] bg-[#fdecec] p-4">
      <h2 className="text-sm font-semibold leading-[normal] text-[#9a2a2a]">Escalated · {escalationReasonLabel(escalation.reason)}</h2>
      <p className="text-[13px] leading-[normal] break-words whitespace-pre-wrap text-[#1f1a2e]">{escalation.note}</p>
      <p className="text-xs leading-[normal] text-[#6e6680]">
        {escalation.byName} asked the Managers on {formatDate(new Date(escalation.at))}. They stay on the Ticket until a Manager takes it or sends it back.
      </p>
    </section>
  );
}
