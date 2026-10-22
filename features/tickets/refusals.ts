import type { ReplyOutcome, TicketActionOutcome } from "./actions";
import { IMAGE_REFUSALS } from "./attachments";

type Refusal = Exclude<TicketActionOutcome | ReplyOutcome, { ok: true }>;

const REASONS: Record<Refusal["reason"], string> = {
  "not-found": "This Ticket no longer exists.",
  claimed: "Another Staff member has already claimed this Ticket.",
  "not-claimer": "Only the Staff member who claimed a Ticket can release it.",
  "not-claimed": "This Ticket is no longer claimed by you.",
  completed: "The Customer has completed this Ticket, so it can no longer change.",
  "already-resolved": "This Ticket is already resolved.",
  "empty-message": "Write a reply or attach an image first.",
  ...IMAGE_REFUSALS,
  "storage-unavailable": "CREOMS could not store that image. Try again in a moment.",
  unavailable: "CREOMS could not save that. Try again in a moment.",
};

/** What to tell Staff when the server refuses; a refused Claim names who holds the Ticket. */
export function refusalMessage(outcome: Refusal): string {
  if (outcome.reason === "claimed" && "claimerName" in outcome && outcome.claimerName)
    return `${outcome.claimerName} has already claimed this Ticket.`;

  return REASONS[outcome.reason];
}
