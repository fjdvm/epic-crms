import type { TicketPriority } from "./tickets";

/** The Categories the storefront gives a Ticket. */
export const TICKET_CATEGORIES = ["Order Issue", "Payment Issue", "Delivery Issue", "Product Question", "Other"] as const;

export type SuggestField = "category" | "priority";

export type SuggestFailure =
  | "not-found"
  | "completed"
  | "unavailable"
  | "model-failed"
  | "no-keys"
  | "invalid-value"
  | "unchanged"
  | "no-suggestion";

export const SUGGEST_REFUSALS: Record<SuggestFailure | "read-only", string> = {
  "not-found": "This Ticket no longer exists.",
  completed: "The Customer has completed this Ticket, so it can no longer change.",
  unavailable: "CREOMS could not save that. Try again in a moment.",
  "model-failed": "The AI could not suggest right now. Set Category and Priority yourself, or try again.",
  "no-keys": "The AI is not set up, so there is no suggestion. Set Category and Priority yourself.",
  "invalid-value": "Choose a valid value.",
  unchanged: "This Ticket already has that value.",
  "no-suggestion": "That suggestion is no longer there. Ask for a new one.",
  "read-only": "Your Role can only view shop work.",
};

export interface Decision {
  kind: "accepted" | "changed";
  applied: string;
  by: string;
}

export interface TicketSuggestion {
  id: number;
  model: string;
  /** What was sent to the model, as recorded. */
  sentText: string;
  category: string;
  categoryReason: string;
  priority: TicketPriority;
  priorityReason: string;
  categoryDecision: Decision | null;
  priorityDecision: Decision | null;
  createdAt: Date;
}

/** A suggestion as it crosses to the browser: the date is text. */
export type SerializedSuggestion = Omit<TicketSuggestion, "createdAt"> & { createdAt: string };

export function serializeSuggestion(s: TicketSuggestion): SerializedSuggestion {
  return { ...s, createdAt: s.createdAt.toISOString() };
}
