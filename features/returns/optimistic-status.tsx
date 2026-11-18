"use client";

import { createContext, useContext, useOptimistic, type ReactNode } from "react";

import { Pill } from "@/features/tickets/pill";

import { returnLabel } from "./refund-record";
import type { ReturnStatus } from "./returns";
import { STATUS_PILLS } from "./returns-table";

/** What the Refund proof card and the Mark refunded step need to know about the proof Staff saved (#615). Saving is refund recording, so it is never shown ahead of the server. */
export interface SavedProof { amountInCentavos: number; method: string; refundedOn: string; reference: string; reading: boolean; unresolved: string[] }

const Context = createContext<{ status: ReturnStatus; show: (status: ReturnStatus) => void } | null>(null);

/**
 * Holds the Return's status shown on the page. `show` is called inside a transition by an optimistic action, so the screen
 * changes at once and React puts the stored status back by itself if the server refuses (ADR-0002).
 */
export function OptimisticReturn({ status, children }: { status: ReturnStatus; children: ReactNode }) {
  const [shown, show] = useOptimistic<ReturnStatus, ReturnStatus>(status, (_current, next) => next);

  return <Context.Provider value={{ status: shown, show }}>{children}</Context.Provider>;
}

/** The status on screen, and the way to show another at once. Without a provider the stored status is used and `show` does nothing. */
export function useShownStatus(stored: ReturnStatus) {
  const context = useContext(Context);

  return { status: context?.status ?? stored, show: context?.show ?? (() => {}) };
}

export function ReturnStatusPill({ status, goodsRequired }: { status: ReturnStatus; goodsRequired?: boolean | null }) {
  const shown = useShownStatus(status).status;

  return <Pill className={STATUS_PILLS[shown]}>{returnLabel(shown, shown === status ? goodsRequired : null)}</Pill>;
}
