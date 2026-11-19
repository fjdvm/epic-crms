"use client";

import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { useClaim } from "./claim";
import { EscalateDialog } from "./escalate-ui";
import { NoteBox } from "./notes";
import { useHold } from "./hold";

const OUTLINE =
  "rounded-lg border border-[#e6e1ee] bg-white px-[14px] py-[9px] text-sm font-medium leading-[normal] whitespace-nowrap text-[#1f1a2e] disabled:opacity-50";

/** The chat's Add internal note and Escalate buttons, each opening its own dialog. Needs the Claim, Hold and Notes providers. */
export function TicketMoreMenu({ ticketId, canNote, canEscalate }: { ticketId: number; canNote: boolean; canEscalate: boolean }) {
  const { isClaimer, escalation } = useClaim();
  const { status } = useHold();
  const [noting, setNoting] = useState(false);
  const mayEscalate = canEscalate && status !== "completed" && isClaimer && !escalation;

  if (!canNote && !mayEscalate) return null;

  return (
    <>
      {canNote && (
        <button type="button" className={OUTLINE} onClick={() => setNoting(true)}>
          Add internal note
        </button>
      )}
      {mayEscalate && <EscalateDialog ticketId={ticketId} />}

      <Dialog open={noting} onOpenChange={setNoting}>
        <DialogContent className="max-w-[520px] gap-4">
          <DialogTitle className="text-lg font-semibold text-[#1f1a2e]">Internal note on TKT-{ticketId}</DialogTitle>
          <DialogDescription className="sr-only">Write a note only Staff can see.</DialogDescription>
          <NoteBox inline onSaved={() => setNoting(false)} />
        </DialogContent>
      </Dialog>

    </>
  );
}
