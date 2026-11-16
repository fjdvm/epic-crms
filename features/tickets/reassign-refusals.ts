export const REASON_MAX = 500;

export type ReassignFailure =
  | "forbidden"
  | "reason-required"
  | "reason-too-long"
  | "invalid-recipient"
  | "nothing-to-move"
  | "unchanged"
  | "not-found"
  | "completed"
  | "not-claimed"
  /** The Claimer changed since the Manager looked, so the move would have taken it from the wrong person. */
  | "claimer-changed";

/** What to tell a Manager when the server refuses; plain words, never a code. */
export const REASSIGN_REFUSALS: Record<ReassignFailure | "unavailable", string> = {
  forbidden: "Only a CREOMS Manager can reassign Tickets.",
  "reason-required": "Write a reason. Both people are told it.",
  "reason-too-long": `Keep the reason to ${REASON_MAX} characters or fewer.`,
  "invalid-recipient": "Choose an active Staff member who can work Tickets.",
  "nothing-to-move": "Choose at least one Ticket to move.",
  unchanged: "That Staff member already holds this Ticket.",
  "not-found": "This Ticket no longer exists.",
  completed: "The Customer has completed this Ticket, so it can no longer change.",
  "not-claimed": "Nobody holds this Ticket now, so there is no one to move it from. Reload to see it.",
  unavailable: "CREOMS could not save that. Try again in a moment.",
  "claimer-changed": "Someone else changed who holds this Ticket first. Reload to see who has it now.",
};

