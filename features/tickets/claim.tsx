"use client";

import { createContext, useContext } from "react";

import { useOptimisticAction } from "@/hooks/use-optimistic-action";

import { claim as claimAction, release as releaseAction } from "./actions";
import { escalate as escalateAction, sendBack as sendBackAction, takeEscalated, type EscalateOutcome } from "./escalate-actions";
import { ESCALATE_REFUSALS, type EscalationReason } from "./escalate-reasons";
import { assignTicket, type ReassignOutcome } from "./reassign-actions";
import { REASSIGN_REFUSALS } from "./reassign-refusals";
import { refusalMessage } from "./refusals";

export interface Claimer {
  id: string;
  name: string;
}

/** The open escalation as the page shows it; the date travels as text so guesses compare cleanly. */
export interface OpenEscalation {
  reason: EscalationReason;
  note: string;
  byName: string;
  at: string;
}

interface Shown {
  claimer: Claimer | null;
  escalation: OpenEscalation | null;
}

interface ClaimState {
  claimer: Claimer | null;
  /** Set while the Ticket is Escalated: a Manager has been asked, and has neither taken it nor sent it back. */
  escalation: OpenEscalation | null;
  isClaimer: boolean;
  pending: boolean;
  claim: () => void;
  release: () => void;
  /** A Manager moves the Ticket to `to` with a reason; shown at once, rolled back with the reason if refused. */
  reassign: (to: Claimer, reason: string, onDone?: () => void) => void;
  /** The Claimer asks every Manager for help; shows Escalated at once, rolled back with the reason if refused. */
  escalate: (reason: EscalationReason, note: string, onDone?: () => void) => void;
  /** A Manager takes the escalated Ticket and becomes its Claimer. */
  take: () => void;
  /** A Manager sends it back to the Claimer with a note. */
  sendBack: (note: string, onDone?: () => void) => void;
}

const ClaimContext = createContext<ClaimState | null>(null);

const escalateRefusal = (o: Exclude<EscalateOutcome, { ok: true }>) => ESCALATE_REFUSALS[o.reason];

/** Claim, Release, Reassign and Escalate, shown at once and rolled back, with the reason, if the server refuses. */
export function useClaimer(
  ticketId: number,
  server: Claimer | null,
  viewer: Claimer,
  serverEscalation: OpenEscalation | null = null,
): ClaimState {
  const { state, pending, run } = useOptimisticAction<Shown>({ claimer: server, escalation: serverEscalation });

  return {
    claimer: state.claimer,
    escalation: state.escalation,
    isClaimer: state.claimer !== null && state.claimer.id === viewer.id,
    pending,
    claim: () => run({ ...state, claimer: viewer }, () => claimAction(ticketId, crypto.randomUUID()), { refusal: refusalMessage }),
    release: () => run({ ...state, claimer: null }, () => releaseAction(ticketId, crypto.randomUUID()), { refusal: refusalMessage }),
    reassign: (to, reason, onDone) => {
      run({ ...state, claimer: to }, () => assignTicket(ticketId, server?.id ?? null, to.id, reason, crypto.randomUUID()), {
        refusal: (o) => REASSIGN_REFUSALS[(o as Exclude<ReassignOutcome, { ok: true }>).reason],
        onDone: () => onDone?.(),
      });
    },
    escalate: (reason, note, onDone) =>
      run(
        { ...state, escalation: { reason, note: note.trim(), byName: viewer.name, at: new Date().toISOString() } },
        () => escalateAction(ticketId, reason, note, crypto.randomUUID()),
        { refusal: escalateRefusal, onDone: () => onDone?.() },
      ),
    take: () =>
      run({ claimer: viewer, escalation: null }, () => takeEscalated(ticketId, crypto.randomUUID()), { refusal: escalateRefusal }),
    sendBack: (note, onDone) =>
      run({ ...state, escalation: null }, () => sendBackAction(ticketId, note, crypto.randomUUID()), {
        refusal: escalateRefusal,
        onDone: () => onDone?.(),
      }),
  };
}

/** Shares one Ticket's Claimer and escalation, as the Staff member sees them right now, with everything on the page. */
export function ClaimProvider({
  ticketId,
  claimer,
  viewer,
  escalation = null,
  children,
}: {
  ticketId: number;
  claimer: Claimer | null;
  viewer: Claimer;
  escalation?: OpenEscalation | null;
  children: React.ReactNode;
}) {
  return <ClaimContext.Provider value={useClaimer(ticketId, claimer, viewer, escalation)}>{children}</ClaimContext.Provider>;
}

export function useClaim(): ClaimState {
  const state = useContext(ClaimContext);
  if (!state) throw new Error("useClaim needs a ClaimProvider");

  return state;
}

/** The Claimer's name, or "Unclaimed". */
export function ClaimerName() {
  return <>{useClaim().claimer?.name ?? "Unclaimed"}</>;
}

/** "Claimed by you", "Claimed by Bernice" or "Unclaimed", as the chat header says it. */
export function ClaimedBy() {
  const { claimer, isClaimer } = useClaim();

  return <>{claimer === null ? "Unclaimed" : isClaimer ? "Claimed by you" : `Claimed by ${claimer.name}`}</>;
}

/** Picks what to show by who holds the Ticket right now: the viewer, someone else, or nobody. */
export function ByClaimer({
  mine,
  theirs,
  nobody,
}: {
  mine: React.ReactNode;
  theirs: React.ReactNode;
  nobody: React.ReactNode;
}) {
  const { claimer, isClaimer } = useClaim();

  return <>{claimer === null ? nobody : isClaimer ? mine : theirs}</>;
}
