import type { ReplyOutcome, TicketActionOutcome } from "./actions";
import { IMAGE_REFUSALS } from "./attachments";

type Refusal = Exclude<TicketActionOutcome | ReplyOutcome, { ok: true }>;

const REASONS: Record<Refusal["reason"], string> = {
  "invalid-priority": "Choose a valid Priority.",
  "invalid-hold-reason": "Choose what you are waiting on.",
  "invalid-hold-date": "Choose a date and time in the future for the Ticket to return to Open.",
  "note-too-long": "Keep the note to 500 characters or fewer.",
  "internal-note-too-long": "That note is too long. Keep it to 2,000 characters or fewer.",
  "not-open": "Only an Open Ticket can be put on hold.",
  "not-on-hold": "This Ticket is no longer on hold.",
  unchanged: "This Ticket already has that Priority.",
  "not-found": "This Ticket no longer exists.",
  claimed: "Another Staff member has already claimed this Ticket.",
  "not-claimer": "Only the Staff member who claimed a Ticket can release it.",
  "not-claimed": "This Ticket is no longer claimed by you.",
  completed: "The Customer has completed this Ticket, so it can no longer change.",
  "already-resolved": "This Ticket is already resolved.",
  "empty-message": "Write a reply or attach a file first.",
  "note-empty": "Write the note first.",
  ...IMAGE_REFUSALS,
  "invalid-draft": "That Drafted reply is unavailable. Discard it and write your reply by hand, or ask for a new draft.",
  "invalid-attachment": "That attachment is invalid or expired. Attach the file again.",
  "storage-unavailable": "CREOMS could not store that file. Try again in a moment.",
  "read-only": "Your Role can only view shop work.",
  unavailable: "CREOMS could not save that. Try again in a moment.",
};

/** What to tell Staff when the server refuses; a refused Claim names who holds the Ticket. */
export function refusalMessage(outcome: Refusal): string {
  if (outcome.reason === "claimed" && "claimerName" in outcome && outcome.claimerName)
    return `${outcome.claimerName} has already claimed this Ticket.`;

  return REASONS[outcome.reason];
}
