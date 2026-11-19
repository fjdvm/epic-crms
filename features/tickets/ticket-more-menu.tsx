"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { useClaim } from "./claim";
import { EscalateDialog } from "./escalate-ui";
import { NoteBox } from "./notes";
import { useHold } from "./hold";

/** The three-dots menu on a chat: Add internal note and Escalate, each opening its own dialog. Needs the Claim, Hold and Notes providers. */
export function TicketMoreMenu({ ticketId, canNote, canEscalate }: { ticketId: number; canNote: boolean; canEscalate: boolean }) {
  const { isClaimer, escalation } = useClaim();
  const { status } = useHold();
  const [noting, setNoting] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const mayEscalate = canEscalate && status !== "completed" && isClaimer && !escalation;

  if (!canNote && !mayEscalate) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="More actions" className="rounded-lg border border-[#e6e1ee] bg-white p-1.5 text-[#1f1a2e]">
            <MoreHorizontal aria-hidden className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canNote && <DropdownMenuItem onSelect={() => setNoting(true)}>Add internal note</DropdownMenuItem>}
          {mayEscalate && <DropdownMenuItem onSelect={() => setEscalating(true)}>Escalate</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={noting} onOpenChange={setNoting}>
        <DialogContent className="max-w-[520px] gap-4">
          <DialogTitle className="text-lg font-semibold text-[#1f1a2e]">Internal note on TKT-{ticketId}</DialogTitle>
          <DialogDescription className="sr-only">Write a note only Staff can see.</DialogDescription>
          <NoteBox inline onSaved={() => setNoting(false)} />
        </DialogContent>
      </Dialog>

      {mayEscalate && <EscalateDialog ticketId={ticketId} controlled={{ open: escalating, onOpenChange: setEscalating }} />}
    </>
  );
}
