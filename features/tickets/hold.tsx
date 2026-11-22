"use client";

import { createContext, useContext } from "react";
import { toast } from "sonner";

import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { formatDate } from "@/features/customer-profiles/format";

import { putOnHold as putOnHoldAction, takeOffHold as takeOffHoldAction } from "./actions";
import { Pill } from "./pill";
import { refusalMessage } from "./refusals";
import { HOLD_REASONS, type HoldReason, type TicketHold, type TicketStatus } from "./tickets";
import { STATUS_LABELS, STATUS_PILLS } from "./status";

/** What the page shows of a Ticket's hold: dates travel as text so the guess compares cleanly with the server's. */
interface HoldState {
  status: TicketStatus;
  hold: { reason: HoldReason; note: string | null; until: string } | null;
}

export interface HoldRequestInput {
  reason: HoldReason;
  note: string;
  until: string;
  message: string;
}

interface HoldContext {
  status: TicketStatus;
  hold: HoldState["hold"];
  pending: boolean;
  /** Puts the Ticket on hold at once on screen, and rolls back with the reason if the server refuses. */
  putOnHold: (request: HoldRequestInput, onDone?: () => void) => void;
  takeOffHold: () => void;
}

const Context = createContext<HoldContext | null>(null);

/** Shares one Ticket's status and hold, as Staff see it right now, with everything on the page that shows them. */
export function HoldProvider({
  ticketId,
  status,
  hold,
  children,
}: {
  ticketId: number;
  status: TicketStatus;
  hold: TicketHold | null;
  children: React.ReactNode;
}) {
  const server: HoldState = {
    status,
    hold: hold ? { reason: hold.reason, note: hold.note, until: new Date(hold.until).toISOString() } : null,
  };
  const { state, pending, run } = useOptimisticAction(server);

  const value: HoldContext = {
    status: state.status,
    hold: state.hold,
    pending,
    putOnHold: (request, onDone) =>
      run(
        {
          status: "on_hold",
          hold: { reason: request.reason, note: request.note.trim() || null, until: new Date(request.until).toISOString() },
        },
        () =>
          putOnHoldAction(
            ticketId,
            { ...request, until: new Date(request.until).toISOString() },
            crypto.randomUUID(),
          ),
        {
          refusal: refusalMessage,
          onDone: (outcome) => {
            if (outcome.ok && "messageSent" in outcome && outcome.messageSent === false) toast.warning("On hold, but the Message to the Customer could not be sent. Write it in the chat instead.");
            onDone?.();
          },
        },
      ),
    takeOffHold: () =>
      run({ status: "open", hold: null }, () => takeOffHoldAction(ticketId, crypto.randomUUID()), {
        refusal: refusalMessage,
      }),
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useHold(): HoldContext {
  const value = useContext(Context);
  if (!value) throw new Error("useHold needs a HoldProvider");

  return value;
}

/** The Ticket's status pill, following Put on hold and Take off hold as they happen. */
export function StatusPill() {
  const { status } = useHold();

  return <Pill className={STATUS_PILLS[status]}>{STATUS_LABELS[status]}</Pill>;
}

/** Why the Ticket is quiet. Any Staff see it; the Customer never does. */
export function HoldSummary() {
  const { status, hold } = useHold();
  if (status !== "on_hold" || !hold) return null;

  const reason = HOLD_REASONS.find((r) => r.value === hold.reason)?.label ?? hold.reason;

  return (
    <section aria-label="On hold" className="space-y-1.5 rounded-xl border border-[#f1dfb0] bg-[#fdf1d8] p-4">
      <h2 className="text-sm font-semibold leading-[normal] text-[#8a5a00]">On hold · waiting on {reason}</h2>
      <p className="text-[13px] leading-[normal] text-[#8a5a00]">
        Returns to Open on {formatDate(new Date(hold.until))},{" "}
        {new Date(hold.until).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}. The Customer sees &ldquo;We&apos;re on it&rdquo;, not the reason.
      </p>
      {hold.note && <p className="text-[13px] leading-[normal] break-words whitespace-pre-wrap text-[#1f1a2e]">Note (Staff only): {hold.note}</p>}
    </section>
  );
}
