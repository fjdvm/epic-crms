import type postgres from "postgres";

import { checkImage, type FileStorage, type ImageRefusal, type ImageUpload } from "./attachments";
import { discard, type Actor, type SendAppEmail } from "./ticket-actions";
import { TICKET_PRIORITIES } from "./tickets";

const SEARCH_LIMIT = 8;

export interface CustomerChoice {
  id: string;
  name: string;
  email: string;
}

export interface OrderChoice {
  id: number;
  status: string;
  createdAt: Date;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Customers Staff can open a Ticket for. Only real Customers (verified email) are found: Walk-in
 * Customers live in CREOMS's own database, never in this one, and Leads are not yet Customers.
 */
export async function searchCustomers(sql: postgres.Sql, term: string): Promise<CustomerChoice[]> {
  const text = term.trim();
  if (!text) return [];

  const pattern = `%${escapeLike(text)}%`;
  const rows = await sql<{ id: string; full_name: string; email: string }[]>`
    select c.id, c.full_name, c.email
    from public.customers c
    join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
    where c.full_name ilike ${pattern} or c.email ilike ${pattern}
    order by c.full_name, c.id
    limit ${SEARCH_LIMIT}`;

  return rows.map((r) => ({ id: r.id, name: r.full_name, email: r.email }));
}

/** The Linked order choices: that Customer's own Orders, newest first, and nobody else's. */
export async function customerOrders(sql: postgres.Sql, customerId: string): Promise<OrderChoice[]> {
  const rows = await sql<{ id: number; status: string; created_at: Date }[]>`
    select id, status, created_at from public.orders
    where customer_id = ${customerId}
    order by created_at desc, id desc`;

  return rows.map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at }));
}

export interface NewTicketInput {
  subject: string;
  customerId: string;
  orderId: number | null;
  /** As received from the form; checked against the Priorities by openTicket. */
  priority: string;
  /** Becomes the first Message, written for the Customer to read. */
  description: string;
  image?: ImageUpload;
}

export type OpenTicketFailure =
  | "empty-subject"
  | "invalid-priority"
  | "empty-message"
  /** Not a verified Customer: unknown, a Lead, or a Walk-in Customer. */
  | "unknown-customer"
  /** The Linked order is not one of that Customer's Orders. */
  | "order-not-theirs"
  | ImageRefusal
  | "storage-unavailable";

export type OpenTicketResult =
  // null means the email is scheduled after the save response.
  | { ok: true; id: number; emailed: boolean | null }
  | { ok: false; reason: OpenTicketFailure };

export interface OpenTicketDeps {
  storefrontTicketUrl: (id: number) => string;
  sendEmail: SendAppEmail;
  storage?: FileStorage;
  /** Schedule nonessential work after the save response, once the Ticket and Message exist. */
  afterSave?: (task: () => Promise<void>) => void;
}

/**
 * Staff open a Ticket on a Customer's behalf. The Staff member Claims it, the description is its
 * first Message, and the Customer is emailed once with a link to it. The Ticket and its first
 * Message land together or not at all; a failed email does not undo the Ticket. `reader` reaches
 * Customers and Orders, which the writer role cannot.
 */
export async function openTicket(
  writer: postgres.Sql,
  reader: postgres.Sql,
  actor: Actor,
  input: NewTicketInput,
  deps: OpenTicketDeps,
): Promise<OpenTicketResult> {
  const subject = input.subject.trim();
  const description = input.description.trim();

  if (!subject) return { ok: false, reason: "empty-subject" };
  if (!(TICKET_PRIORITIES as string[]).includes(input.priority)) return { ok: false, reason: "invalid-priority" };
  if (!description && !input.image) return { ok: false, reason: "empty-message" };

  const [customer] = await reader<{ email: string; first_name: string; full_name: string }[]>`
    select c.email, c.first_name, c.full_name
    from public.customers c
    join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
    where c.id = ${input.customerId}`;

  if (!customer) return { ok: false, reason: "unknown-customer" };

  if (input.orderId !== null) {
    const [order] = await reader`
      select 1 from public.orders where id = ${input.orderId} and customer_id = ${input.customerId}`;

    if (!order) return { ok: false, reason: "order-not-theirs" };
  }

  let fileId: string | null = null;

  if (input.image) {
    const checked = checkImage(input.image);
    if (!checked.ok) return checked;

    if (!deps.storage) throw new Error("An image needs file-storage");

    try {
      fileId = await deps.storage.upload({
        filename: input.image.filename,
        contentType: checked.contentType,
        bytes: input.image.bytes,
      });
    } catch (error) {
      console.error("A new Ticket's image could not be stored in file-storage", error);

      return { ok: false, reason: "storage-unavailable" };
    }
  }

  let saved: { id: number; messageId: number };

  try {
    saved = await writer.begin(async (tx) => {
      const [ticket] = await tx<{ id: number }[]>`
        insert into tickets (customer_id, subject, order_id, priority, claimed_by_id, claimed_by_name)
        values (${input.customerId}, ${subject}, ${input.orderId}, ${input.priority}, ${actor.id}, ${actor.name})
        returning id`;
      const [message] = await tx<{ id: number }[]>`
        insert into ticket_messages (ticket_id, sender, body, file_id)
        values (${ticket.id}, 'staff', ${description}, ${fileId}) returning id`;

      return { id: ticket.id, messageId: message.id };
    });
  } catch (error) {
    await discard(deps.storage, fileId);

    throw error;
  }

  const followUp = async (): Promise<boolean> => {
    if (fileId !== null && deps.storage) {
      try {
        await deps.storage.linkToMessage(fileId, saved.messageId);
      } catch (error) {
        // The Message already shows the image through its file id; the Link only helps record lookups.
        console.error(`Ticket TKT-${saved.id} image was saved but could not be Linked to its Message`, error);
      }
    }

    try {
      await deps.sendEmail({
        to: customer.email,
        title: `We opened ticket TKT-${saved.id} for you`,
        body: `Hi ${customer.first_name || customer.full_name}, we opened a ticket for you about "${subject}". You can read our message and reply to it from your account.`,
        button: { label: "View your ticket", link: deps.storefrontTicketUrl(saved.id) },
      });
    } catch (error) {
      console.error(`Ticket TKT-${saved.id} was opened but the Customer was not emailed`, error);

      return false;
    }

    return true;
  };

  if (deps.afterSave) {
    deps.afterSave(async () => { await followUp(); });
    return { ok: true, id: saved.id, emailed: null };
  }
  return { ok: true, id: saved.id, emailed: await followUp() };
}
