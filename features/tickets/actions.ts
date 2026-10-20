"use server";

import { revalidatePath } from "next/cache";

import {
  gatewayFileStorage,
  liveConversationUrl,
  sendAppEmail,
  storefrontTicketUrl,
} from "@/lib/gateway";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase, ticketsWriterDatabase } from "@/lib/tickets-db";

import { customerOrders, openTicket, searchCustomers, type CustomerChoice, type OpenTicketResult, type OrderChoice } from "./new-ticket";
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

/** The reply form: a `body` and, optionally, one `image` file. */
export async function reply(id: number, form: FormData) {
  const body = String(form.get("body") ?? "");
  const file = form.get("image");
  // An empty file input still posts a nameless, empty File; that is "no image", not an empty image.
  const picked = file instanceof File && (file.size > 0 || file.name !== "") ? file : null;

  return act(id, async (actor) =>
    replyToTicket(
      ticketsWriterDatabase(),
      id,
      actor,
      body,
      picked
        ? {
            image: { filename: picked.name || "image", bytes: new Uint8Array(await picked.arrayBuffer()) },
            storage: gatewayFileStorage,
          }
        : undefined,
    ),
  );
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

export type OpenTicketOutcome = OpenTicketResult | { ok: false; reason: "unavailable" };

/** The New ticket dialog: `subject`, `customerId`, optional `orderId`, `priority`, `description` and optional `image`. */
export async function openNewTicket(form: FormData): Promise<OpenTicketOutcome> {
  const staff = await requireModule(TICKETS_MODULE);

  const file = form.get("image");
  const picked = file instanceof File && (file.size > 0 || file.name !== "") ? file : null;
  const orderId = String(form.get("orderId") ?? "");

  try {
    const result = await openTicket(
      ticketsWriterDatabase(),
      ticketsDatabase(),
      { id: staff.username, name: staff.name },
      {
        subject: String(form.get("subject") ?? ""),
        customerId: String(form.get("customerId") ?? ""),
        orderId: /^\d+$/.test(orderId) ? Number(orderId) : null,
        priority: String(form.get("priority") ?? "normal"),
        description: String(form.get("description") ?? ""),
        image: picked
          ? { filename: picked.name || "image", bytes: new Uint8Array(await picked.arrayBuffer()) }
          : undefined,
      },
      { storefrontTicketUrl, sendEmail: sendAppEmail, storage: gatewayFileStorage },
    );
    if (result.ok) revalidatePath("/tickets");

    return result;
  } catch (error) {
    console.error("Ticket could not be opened", error);

    return { ok: false, reason: "unavailable" };
  }
}

/** Customer search for the dialog; an unreachable database finds nobody rather than breaking the dialog. */
export async function findCustomers(term: string): Promise<CustomerChoice[]> {
  await requireModule(TICKETS_MODULE);

  try {
    return await searchCustomers(ticketsDatabase(), term);
  } catch (error) {
    console.error("Customers could not be searched", error);

    return [];
  }
}

/** The chosen Customer's Orders, for the Linked order choice. */
export async function findCustomerOrders(customerId: string): Promise<OrderChoice[]> {
  await requireModule(TICKETS_MODULE);

  try {
    return await customerOrders(ticketsDatabase(), customerId);
  } catch (error) {
    console.error("Orders could not be read", error);

    return [];
  }
}
