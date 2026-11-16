import type postgres from "postgres";
import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { HOLD_NOTE_MAX, HOLD_REASONS, TICKET_PRIORITIES, type HoldReason } from "./tickets";

import { checkImage, type FileStorage, type ImageRefusal, type ImageUpload } from "./attachments";

export interface TicketAudit {
  trail: AuditTrail;
  operationId: string;
  staff: { id: string; name: string };
}

async function auditChange(audit: TicketAudit | undefined, id: number, action: string, change: string) {
  if (!audit) return;
  await recordAudit(audit.trail, {
    module: TICKETS_MODULE, action, outcome: "success", actor: staffAuditActor(audit.staff),
    target: { type: "ticket", id: String(id), display_name: `TKT-${id}` },
    description: `${audit.staff.name} ${change} TKT-${id}.`,
    occurred_at: new Date().toISOString(), operationId: JSON.stringify([audit.staff.id, audit.operationId]),
  });
}

/** The Staff member acting: the Portal username is their opaque id, and the name is snapshotted onto the Ticket. */
export interface Actor {
  id: string;
  name: string;
}

export type TicketActionFailure =
  | "invalid-priority"
  | "invalid-hold-reason"
  /** The date and time it returns to Open is missing, unreadable or not in the future. */
  | "invalid-hold-date"
  | "note-too-long"
  /** Only an Open Ticket goes on hold. */
  | "not-open"
  | "not-on-hold"
  | "unchanged"
  | "not-found"
  /** Someone else holds the Claim; nobody takes a Claimed Ticket from its Claimer. */
  | "claimed"
  | "not-claimer"
  | "not-claimed"
  /** Completed is final. */
  | "completed"
  | "already-resolved"
  | "empty-message"
  | "invalid-attachment"
  | ImageRefusal
  /** file-storage could not take the image; nothing was saved. */
  | "storage-unavailable";

export type TicketActionResult =
  | { ok: true }
  /** `claimerName` is set when the reason is "claimed", so the refusal can say who holds the Ticket. */
  | { ok: false; reason: TicketActionFailure; claimerName?: string };

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
export async function claimTicket(sql: postgres.Sql, id: number, actor: Actor, audit?: TicketAudit): Promise<TicketActionResult> {
  const rows = await sql`
    update tickets set claimed_by_id = ${actor.id}, claimed_by_name = ${actor.name}
    where id = ${id} and claimed_by_id is null and status <> 'completed'
    returning id`;

  if (rows.length) {
    await auditChange(audit, id, "ticket.claimed", "claimed Ticket");
    return { ok: true };
  }

  const reason = await whyNot(sql, id, actor);
  if (reason !== "not-claimed" && reason !== "claimed") return { ok: false, reason };

  const [held] = await sql<{ claimed_by_name: string | null }[]>`
    select claimed_by_name from tickets where id = ${id}`;

  return { ok: false, reason: "claimed", claimerName: held?.claimed_by_name ?? undefined };
}

/** Only the Claimer can release a Ticket back to Unclaimed. */
export async function releaseTicket(
  sql: postgres.Sql,
  id: number,
  actor: Actor,
  audit?: TicketAudit,
): Promise<TicketActionResult> {
  const rows = await sql`
    update tickets set claimed_by_id = null, claimed_by_name = null,
      status = case when status = 'on_hold' then 'open' else status end,
      hold_reason = null, hold_note = null, hold_until = null
    where id = ${id} and claimed_by_id = ${actor.id} and status <> 'completed'
    returning id`;

  if (rows.length) {
    await auditChange(audit, id, "ticket.released", "released Ticket");
    return { ok: true };
  }

  const reason = await whyNot(sql, id, actor);

  return { ok: false, reason: reason === "claimed" ? "not-claimer" : reason };
}

/**
 * Only the Claimer can reply. Direct File ids are trusted inputs verified by the server action;
 * legacy images are uploaded here. Only images created in this call are discarded on a failed save,
 * since a confirmed direct upload may already belong to an earlier Message.
 */
export async function replyToTicket(
  sql: postgres.Sql,
  id: number,
  actor: Actor,
  body: string,
  attachment?: ({ image: ImageUpload } | { fileId: string }) & { storage: FileStorage },
): Promise<ReplyResult> {
  const text = body.trim();
  if (!text && !attachment) return { ok: false, reason: "empty-message" };

  let fileId: string | null = attachment && "fileId" in attachment ? attachment.fileId : null;

  if (attachment && "image" in attachment) {
    const checked = checkImage(attachment.image);
    if (!checked.ok) return checked;

    try {
      if (!attachment.storage.upload) throw new Error("Use a confirmed direct upload");
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
    if (attachment && "image" in attachment) await discard(attachment.storage, fileId);

    throw error;
  }

  if (!result.ok) {
    if (attachment && "image" in attachment) await discard(attachment.storage, fileId);
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
  audit?: TicketAudit,
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

  await auditChange(audit, id, "ticket.status_changed", "marked Resolved Ticket");

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

/** Priority may change while a Ticket is Open or Resolved; Completed is final. */
export async function changeTicketPriority(sql: postgres.Sql, id: number, priority: string, audit?: TicketAudit): Promise<TicketActionResult> {
  if (!(TICKET_PRIORITIES as string[]).includes(priority)) return { ok: false, reason: "invalid-priority" };
  const [row] = await sql`
    update tickets set priority = ${priority}
    where id = ${id} and status <> 'completed' and priority <> ${priority}
    returning id`;
  if (!row) {
    const [ticket] = await sql`select status from tickets where id = ${id}`;
    return { ok: false, reason: !ticket ? "not-found" : ticket.status === "completed" ? "completed" : "unchanged" };
  }
  await auditChange(audit, id, "ticket.priority_changed", `changed Priority to ${priority} on Ticket`);
  return { ok: true };
}

export interface HoldRequest {
  reason: string;
  /** Staff-only; optional. */
  note?: string;
  /** When the Ticket returns to Open by itself. */
  until: Date | null;
}

/**
 * Only the Claimer puts an Open Ticket on hold, with a reason and the date and time it returns to Open.
 * The date is required so a hold can never sit forever; the scheduled job in the shop returns it when due.
 */
export async function putTicketOnHold(
  sql: postgres.Sql,
  id: number,
  actor: Actor,
  request: HoldRequest,
  audit?: TicketAudit,
  now: Date = new Date(),
): Promise<TicketActionResult> {
  if (!HOLD_REASONS.some((r) => r.value === request.reason)) return { ok: false, reason: "invalid-hold-reason" };
  if (!request.until || Number.isNaN(request.until.getTime()) || request.until.getTime() <= now.getTime())
    return { ok: false, reason: "invalid-hold-date" };

  const note = request.note?.trim() || null;
  if (note && note.length > HOLD_NOTE_MAX) return { ok: false, reason: "note-too-long" };

  const rows = await sql`
    update tickets set status = 'on_hold', hold_reason = ${request.reason as HoldReason}, hold_note = ${note},
      hold_until = ${request.until}
    where id = ${id} and status = 'open' and claimed_by_id = ${actor.id}
    returning id`;

  if (rows.length) {
    const label = HOLD_REASONS.find((r) => r.value === request.reason)!.label;
    await auditChange(audit, id, "ticket.put_on_hold", `put on hold (${label}, until ${request.until.toISOString()}) Ticket`);
    return { ok: true };
  }

  const reason = await whyNot(sql, id, actor);
  if (reason !== "not-claimed") return { ok: false, reason: reason === "claimed" ? "not-claimer" : reason };

  const [t] = await sql<{ status: string; claimed_by_id: string | null }[]>`select status, claimed_by_id from tickets where id = ${id}`;

  return { ok: false, reason: t?.claimed_by_id === actor.id ? "not-open" : "not-claimed" };
}

/** Only the Claimer takes a Ticket off hold early, back to Open. */
export async function takeTicketOffHold(sql: postgres.Sql, id: number, actor: Actor, audit?: TicketAudit): Promise<TicketActionResult> {
  const rows = await sql`
    update tickets set status = 'open', hold_reason = null, hold_note = null, hold_until = null
    where id = ${id} and status = 'on_hold' and claimed_by_id = ${actor.id}
    returning id`;

  if (rows.length) {
    await auditChange(audit, id, "ticket.taken_off_hold", "took off hold Ticket");
    return { ok: true };
  }

  const [t] = await sql<{ status: string; claimed_by_id: string | null }[]>`select status, claimed_by_id from tickets where id = ${id}`;
  if (!t) return { ok: false, reason: "not-found" };
  if (t.status === "completed") return { ok: false, reason: "completed" };
  if (t.claimed_by_id !== actor.id) return { ok: false, reason: "not-claimer" };

  return { ok: false, reason: "not-on-hold" };
}
