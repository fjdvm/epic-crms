"use client";

import { createContext, useContext } from "react";

import { useOptimisticAction } from "@/hooks/use-optimistic-action";

import { claim as claimAction, release as releaseAction } from "./actions";
import { refusalMessage } from "./refusals";

export interface Claimer {
  id: string;
  name: string;
}

interface ClaimState {
  claimer: Claimer | null;
  isClaimer: boolean;
  pending: boolean;
  claim: () => void;
  release: () => void;
}

const ClaimContext = createContext<ClaimState | null>(null);

/** Claim and Release, shown at once and rolled back, with the reason, if the server refuses. */
export function useClaimer(ticketId: number, server: Claimer | null, viewer: Claimer): ClaimState {
  const { state, pending, run } = useOptimisticAction(server);

  return {
    claimer: state,
    isClaimer: state !== null && state.id === viewer.id,
    pending,
    claim: () => run(viewer, () => claimAction(ticketId), { refusal: refusalMessage }),
    release: () => run(null, () => releaseAction(ticketId), { refusal: refusalMessage }),
  };
}

/** Shares one Ticket's Claimer, as the Staff member sees it right now, with everything on the page that shows it. */
export function ClaimProvider({
  ticketId,
  claimer,
  viewer,
  children,
}: {
  ticketId: number;
  claimer: Claimer | null;
  viewer: Claimer;
  children: React.ReactNode;
}) {
  return <ClaimContext.Provider value={useClaimer(ticketId, claimer, viewer)}>{children}</ClaimContext.Provider>;
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
