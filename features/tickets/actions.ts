"use server";

import { revalidatePath } from "next/cache";

import { sendAppEmail, storefrontTicketUrl } from "@/lib/gateway";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase, ticketsWriterDatabase } from "@/lib/tickets-db";

import {
  claimTicket,
  markResolved,
  releaseTicket,
  replyToTicket,
  type Actor,
  type TicketActionResult,
} from "./ticket-actions";

export type TicketActionOutcome = TicketActionResult | { ok: false; reason: "unavailable" };

/** Server actions are public endpoints, so each proves the Staff member holds the Tickets Module. */
async function act(
  id: number,
  run: (actor: Actor) => Promise<TicketActionResult>,
): Promise<TicketActionOutcome> {
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

export const claim = (id: number) => act(id, (actor) => claimTicket(ticketsWriterDatabase(), id, actor));

export const release = (id: number) => act(id, (actor) => releaseTicket(ticketsWriterDatabase(), id, actor));

export const reply = (id: number, body: string) =>
  act(id, (actor) => replyToTicket(ticketsWriterDatabase(), id, actor, body));

export const resolve = (id: number) =>
  act(id, () =>
    markResolved(ticketsWriterDatabase(), ticketsDatabase(), id, storefrontTicketUrl, sendAppEmail),
  );
