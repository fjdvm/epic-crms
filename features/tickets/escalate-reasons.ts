export type EscalationReason = "service_level" | "money" | "food_safety" | "customer_upset";

/** Why the Claimer is asking a Manager for help, as the Escalate dialog words it. */
export const ESCALATION_REASONS: { value: EscalationReason; label: string }[] = [
  { value: "service_level", label: "Service level about to be or was missed" },
  { value: "money", label: "Money decision" },
  { value: "food_safety", label: "Food safety or possible illness" },
  { value: "customer_upset", label: "Customer upset" },
];

export const ESCALATION_NOTE_MAX = 500;

export function escalationReasonLabel(reason: string): string {
  return ESCALATION_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

export type EscalateFailure =
  | "forbidden"
  | "invalid-reason"
  | "note-required"
  | "note-too-long"
  | "not-found"
  | "completed"
  | "not-claimer"
  | "already-escalated"
  | "not-escalated"
  /** The Claimer changed since the Manager looked, so taking it would have moved it from the wrong person. */
  | "claimer-changed"
  | "not-claimed"
  | "invalid-recipient"
  | "unavailable"
  | "read-only";

/** What to tell Staff or a Manager when the server refuses; plain words, never a code. */
export const ESCALATE_REFUSALS: Record<EscalateFailure, string> = {
  forbidden: "Only a Manager can take or send back an escalation.",
  "invalid-reason": "Choose why you are escalating.",
  "note-required": "Write a short note so the Manager knows what you need.",
  "note-too-long": `Keep the note to ${ESCALATION_NOTE_MAX} characters or fewer.`,
  "not-found": "This Ticket no longer exists.",
  completed: "The Customer has completed this Ticket, so it can no longer change.",
  "not-claimer": "Only the Staff member who claimed this Ticket can escalate it.",
  "already-escalated": "This Ticket is already escalated to the Managers.",
  "not-escalated": "This Ticket is no longer escalated. Reload to see what happened.",
  "claimer-changed": "Someone else changed who holds this Ticket first. Reload to see who has it now.",
  "not-claimed": "Nobody holds this Ticket now, so it cannot be taken. Send it back or reload.",
  "invalid-recipient": "CREOMS could not find you in the Staff directory. Try again in a moment.",
  unavailable: "CREOMS could not save that. Try again in a moment.",
  "read-only": "Your Role can only view shop work.",
};
