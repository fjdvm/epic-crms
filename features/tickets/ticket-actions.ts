import type postgres from "postgres";

import { checkImage, type FileStorage, type ImageRefusal, type ImageUpload } from "./attachments";

/** The Staff member acting: the Portal username is their opaque id, and the name is snapshotted onto the Ticket. */
export interface Actor {
  id: string;
  name: string;
}

export type TicketActionFailure =
  | "not-found"
  /** Someone else holds the Claim; nobody takes a Claimed Ticket from its Claimer. */
  | "claimed"
  | "not-claimer"
  | "not-claimed"
  /** Completed is final. */
  | "completed"
  | "already-resolved"
  | "empty-message"
  | ImageRefusal
  /** file-storage could not take the image; nothing was saved. */
  | "storage-unavailable";

export type TicketActionResult = { ok: true } | { ok: false; reason: TicketActionFailure };

/** A saved reply, with the id the live relay echoes so each side can match its copy. */
export type ReplyResult = { ok: true; messageId: number } | { ok: false; reason: TicketActionFailure };

/** Why a guarded update touched no row. */
async function whyNot(sql: postgres.Sql, id: number, actor: Actor): Promise<TicketActionFailure> {
  const [t] = await sql<{ status: string; claimed_by_id: string | null }[]>`
    select status, claimed_by_id from tickets where id = ${id}`;

  if (!t) return "not-found";
  if (t.status === "completed") return "completed";
  if (t.claimed_by_id === null) return "not-claimed";

  return t.claimed_by_id === actor.id ? "not-claimed" : "claimed";
}

/** Staff take an Unclaimed Ticket for themselves. */
export async function claimTicket(sql: postgres.Sql, id: number, actor: Actor): Promise<TicketActionResult> {
  const rows = await sql`
    update tickets set claimed_by_id = ${actor.id}, claimed_by_name = ${actor.name}
    where id = ${id} and claimed_by_id is null and status <> 'completed'
    returning id`;

  if (rows.length) return { ok: true };

  const reason = await whyNot(sql, id, actor);

  return { ok: false, reason: reason === "not-claimed" ? "claimed" : reason };
}

/** Only the Claimer can release a Ticket back to Unclaimed. */
export async function releaseTicket(
  sql: postgres.Sql,
  id: number,
  actor: Actor,
): Promise<TicketActionResult> {
  const rows = await sql`
    update tickets set claimed_by_id = null, claimed_by_name = null
    where id = ${id} and claimed_by_id = ${actor.id} and status <> 'completed'
    returning id`;

  if (rows.length) return { ok: true };

  const reason = await whyNot(sql, id, actor);

  return { ok: false, reason: reason === "claimed" ? "not-claimer" : reason };
}

/**
 * A Staff Message: text, one JPG or PNG image, or both. Only the Claimer can reply: an Unclaimed
 * Ticket must be Claimed first, and a Ticket someone else Claimed cannot be replied to. An image is
 * stored first and removed again if the Message is not saved, so file-storage never keeps an image
 * no Message shows.
 */
export async function replyToTicket(
  sql: postgres.Sql,
  id: number,
  actor: Actor,
  body: string,
  attachment?: { image: ImageUpload; storage: FileStorage },
): Promise<ReplyResult> {
  const text = body.trim();
  if (!text && !attachment) return { ok: false, reason: "empty-message" };

  let fileId: string | null = null;

  if (attachment) {
    const checked = checkImage(attachment.image);
    if (!checked.ok) return checked;

    try {
      fileId = await attachment.storage.upload({
        filename: attachment.image.filename,
        contentType: checked.contentType,
        bytes: attachment.image.bytes,
      });
    } catch (error) {
      console.error(`Ticket TKT-${id} image could not be stored in file-storage`, error);

      return { ok: false, reason: "storage-unavailable" };
    }
  }

  let result: ReplyResult;

  try {
    result = await saveReply(sql, id, actor, text, fileId);
  } catch (error) {
    await discard(attachment?.storage, fileId);

    throw error;
  }

  if (!result.ok) {
    await discard(attachment?.storage, fileId);
  } else if (attachment && fileId !== null) {
    try {
      await attachment.storage.linkToMessage(fileId, result.messageId);
    } catch (error) {
      // The Message already shows the image through its file id; the Link only helps record lookups.
      console.error(`Ticket TKT-${id} image was saved but could not be Linked to its Message`, error);
    }
  }

  return result;
}

export async function discard(storage: FileStorage | undefined, fileId: string | null) {
  if (!storage || !fileId) return;

  try {
    await storage.remove(fileId);
  } catch (error) {
    console.error("An image for an unsaved Message could not be removed from file-storage", error);
  }
}

function saveReply(
  sql: postgres.Sql,
  id: number,
  actor: Actor,
  text: string,
  fileId: string | null,
): Promise<ReplyResult> {
  return sql.begin(async (tx): Promise<ReplyResult> => {
    const rows = await tx`
      select 1 from tickets
      where id = ${id} and status <> 'completed' and claimed_by_id = ${actor.id}
      for update`;

    if (!rows.length) return { ok: false, reason: await whyNot(tx as unknown as postgres.Sql, id, actor) };

    const [message] = await tx<{ id: number }[]>`
      insert into ticket_messages (ticket_id, sender, body, file_id)
      values (${id}, 'staff', ${text}, ${fileId}) returning id`;

    return { ok: true, messageId: message.id };
  });
}

export interface ResolvedTicket {
  subject: string;
  customerId: string;
}

/** Sends the App email asking the Customer to confirm; see lib/gateway.ts. */
export type SendAppEmail = (email: {
  to: string;
  title: string;
  body: string;
  button: { label: string; link: string };
}) => Promise<void>;

/**
 * Staff mark an Open Ticket Resolved and the Customer is emailed once, asking them to confirm.
 * Staff can never set Completed. `reader` reaches the Customer's email, which the writer role cannot.
 */
export async function markResolved(
  writer: postgres.Sql,
  reader: postgres.Sql,
  id: number,
  storefrontTicketUrl: (id: number) => string,
  sendEmail: SendAppEmail,
): Promise<TicketActionResult & { emailed?: boolean }> {
  const [t] = await writer<{ subject: string; customer_id: string }[]>`
    update tickets set status = 'resolved', resolved_at = now()
    where id = ${id} and status = 'open'
    returning subject, customer_id`;

  if (!t) {
    const [existing] = await writer<{ status: string }[]>`select status from tickets where id = ${id}`;

    if (!existing) return { ok: false, reason: "not-found" };

    return {
      ok: false,
      reason: existing.status === "completed" ? "completed" : "already-resolved",
    };
  }

  try {
    const [customer] = await reader<{ email: string; first_name: string; full_name: string }[]>`
      select email, first_name, full_name from customers where id = ${t.customer_id}`;

    await sendEmail({
      to: customer.email,
      title: `Is your ticket TKT-${id} fixed?`,
      body: `Hi ${customer.first_name || customer.full_name}, we think we have dealt with "${t.subject}". Please let us know whether it is fixed.`,
      button: { label: "Review your ticket", link: storefrontTicketUrl(id) },
    });
  } catch (error) {
    console.error(`Ticket TKT-${id} was marked Resolved but the confirmation email was not sent`, error);

    return { ok: true, emailed: false };
  }

  return { ok: true, emailed: true };
}
