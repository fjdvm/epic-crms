"use server";

import { revalidatePath } from "next/cache";

import {
  liveConversationUrl,
  sendAppEmail,
  storefrontTicketUrl,
} from "@/lib/gateway";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase, ticketsWriterDatabase } from "@/lib/tickets-db";

import {
  claimTicket,
  markResolved,
  releaseTicket,
  replyToTicket,
  type Actor,
  type ReplyResult,
  type TicketActionResult,
} from "./ticket-actions";

export type TicketActionOutcome = TicketActionResult | { ok: false; reason: "unavailable" };
export type ReplyOutcome = ReplyResult | { ok: false; reason: "unavailable" };

/** Server actions are public endpoints, so each proves the Staff member holds the Tickets Module. */
async function act<R extends TicketActionResult | ReplyResult>(
  id: number,
  run: (actor: Actor) => Promise<R>,
): Promise<R | { ok: false; reason: "unavailable" }> {
  const staff = await requireModule(TICKETS_MODULE);

  try {
    const result = await run({ id: staff.username, name: staff.name });
    if (result.ok) revalidatePath(`/tickets/${id}`);

    return result;
  } catch (error) {
    console.error("Ticket could not be changed", error);

    return { ok: false, reason: "unavailable" };
  }
}

export async function claim(id: number) {
  return act(id, (actor) => claimTicket(ticketsWriterDatabase(), id, actor));
}

export async function release(id: number) {
  return act(id, (actor) => releaseTicket(ticketsWriterDatabase(), id, actor));
}

export async function reply(id: number, body: string) {
  return act(id, (actor) => replyToTicket(ticketsWriterDatabase(), id, actor, body));
}

export async function resolve(id: number) {
  return act(id, () =>
    markResolved(ticketsWriterDatabase(), ticketsDatabase(), id, storefrontTicketUrl, sendAppEmail),
  );
}

/**
 * Where the Staff member's browser joins the Ticket's Conversation, or null when the gateway cannot
 * be reached; the Conversation then simply is not live, and Messages still save.
 */
export async function liveUrl(id: number): Promise<string | null> {
  const staff = await requireModule(TICKETS_MODULE);

  try {
    return await liveConversationUrl(id, staff.username);
  } catch (error) {
    console.error("Live ticket could not be issued", error);

    return null;
  }
}
