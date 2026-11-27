"use client";

import { Ellipsis } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useClaim } from "./claim";
import { EscalateDialog } from "./escalate-ui";
import { useHold } from "./hold";

/** The chat's ⋯ menu: the Claimer's Release and Escalate. Needs the Claim and Hold providers. */
export function TicketMoreMenu({ ticketId, canEscalate }: { ticketId: number; canEscalate: boolean }) {
  const { isClaimer, escalation, pending, release } = useClaim();
  const { status } = useHold();
  const [escalating, setEscalating] = useState(false);
  const mayRelease = status !== "completed" && isClaimer && !escalation;
  const mayEscalate = mayRelease && canEscalate;

  return (
    <>
      {mayRelease && (
        // Not modal, so choosing Escalate hands focus to its dialog without leaving the page unclickable.
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label="More actions"
            className="flex size-[37px] shrink-0 items-center justify-center rounded-lg border border-[#e6e1ee] bg-white text-[#1f1a2e]"
          >
            <Ellipsis aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={pending} onSelect={release}>
              Release
            </DropdownMenuItem>
            {mayEscalate && <DropdownMenuItem onSelect={() => setEscalating(true)}>Escalate</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <EscalateDialog ticketId={ticketId} controlled={{ open: escalating, onOpenChange: setEscalating }} />
    </>
  );
}
