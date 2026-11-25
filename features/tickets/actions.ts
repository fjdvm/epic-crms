"use server";

import { randomUUID } from "node:crypto";
import { draftReply, type DraftRequest, type DraftResult } from "./draft";
import { sendWithDraft, type DraftSendResult } from "./draft-send";

import { ticketUpload } from "@/features/files/server";
import { configuredCompleters } from "@/features/feedback/sentiment-clients";
import { crmsDatabase } from "@/lib/crms-db";
import { applyField, suggestForTicket, type SuggestDeps } from "./suggest";
import { serializeSuggestion, type SerializedSuggestion, type SuggestFailure, type SuggestField } from "./suggest-view";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import {
  gatewayAuditTrail,
  gatewayFileStorage,
  liveConversationUrl,
  sendAppEmail,
  storefrontTicketUrl,
} from "@/lib/gateway";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REFUSAL, shopRole } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase, ticketsWriterDatabase } from "@/lib/tickets-db";

import { HOLD_MESSAGE_MAX } from "./tickets";
import { auditTicketDenied, auditTicketSuccess } from "./tickets-audit";
import { customerOrders, openTicket, searchCustomers, type CustomerChoice, type OpenTicketResult, type OrderChoice } from "./new-ticket";
import {
  addInternalNote,
  claimTicket,
  changeTicketPriority,
  markResolved,
  putTicketOnHold,
  releaseTicket,
  takeTicketOffHold,
  replyToTicket,
  type Actor,
  type HoldRequest,
  type TicketAudit,
  type TicketActionResult,
} from "./ticket-actions";

export type TicketActionOutcome = TicketActionResult | { ok: false; reason: "unavailable" | "read-only" };
export type ReplyOutcome = DraftSendResult | { ok: false; reason: "unavailable" | "read-only" };

/** Server actions are public endpoints, so each proves the Staff member holds the Tickets Module. */
async function act<R extends TicketActionResult | DraftSendResult>(
  id: number,
  attempt: { action: string; what: string },
  run: (actor: Actor & { role: string }, audit: TicketAudit) => Promise<R>,
  token?: string,
): Promise<R | { ok: false; reason: "unavailable" | "read-only" }> {
  const staff = await requireModule(TICKETS_MODULE);
  const operationId = token ?? randomUUID();
  // Every refused or failed attempt is one `failure` Audit Event; a replay with the same token or reason records once.
  const denied = async (reason: string) => auditTicketDenied(staff, { type: "ticket", id }, attempt.action, attempt.what, reason, token);

  if (!canWork(staff)) {
    await denied(READ_ONLY_REFUSAL.reason);
    return READ_ONLY_REFUSAL;
  }
  try {
    const result = await run({ id: staff.username, name: staff.name, role: staff.role }, { trail: gatewayAuditTrail, staff, operationId });
    if (result.ok) revalidatePath(`/tickets/${id}`);
    else await denied(result.reason);

    return result;
  } catch (error) {
    console.error("Ticket could not be changed", error);
    await denied("unavailable");

    return { ok: false, reason: "unavailable" };
  }
}

export async function claim(id: number, operationId?: string) {
  return act(id, { action: "ticket.claimed", what: "claim" }, (actor, audit) => claimTicket(ticketsWriterDatabase(), id, actor, audit), operationId);
}

export async function release(id: number, operationId?: string) {
  return act(id, { action: "ticket.released", what: "release" }, (actor, audit) => releaseTicket(ticketsWriterDatabase(), id, actor, audit), operationId);
}

/** The reply form: a `body` and, optionally, one `image` file. */
export async function reply(id: number, form: FormData) {
  const body = String(form.get("body") ?? "");
  const file = form.get("image");
  // An empty file input still posts a nameless, empty File; that is "no image", not an empty image.
  const picked = file instanceof File && (file.size > 0 || file.name !== "") ? file : null;

  const draftField = form.get("draftId");
  const attempt = draftField === null ? { action: "ticket.replied", what: "reply to" } : { action: "ticket.drafted_reply_sent", what: "send a Drafted reply on" };

  return act(id, attempt, async (actor, audit) => {
    const reference = form.get("attachment");
    const upload = typeof reference === "string" ? await ticketUpload(reference, actor.id, id) : null;
    if (reference !== null && (!upload || picked)) return { ok: false, reason: "invalid-attachment" as const };
    const draftReference = form.get("draftId");
    const draftId = draftReference === null ? null : Number(draftReference);
    const send = async () => replyToTicket(ticketsWriterDatabase(), id, actor, body,
      upload ? { fileId: upload.fileId, storage: gatewayFileStorage } : picked ? {
        image: { filename: picked.name || "image", bytes: new Uint8Array(await picked.arrayBuffer()) },
        storage: gatewayFileStorage,
      } : undefined);
    const result = draftId === null ? await send() : await sendWithDraft({ tickets: ticketsDatabase(), crms: crmsDatabase() }, actor, id, body, draftId, send, audit);
    // The Message stays in the Conversation; the event holds ids only, never its text.
    // A Drafted reply is audited as `ticket.drafted_reply_sent` by the send boundary, so it is not recorded twice.
    if (result.ok && draftId === null) {
      await auditTicketSuccess(audit.staff, { type: "ticket", id }, "ticket.replied", "replied on",
        { messageId: result.messageId, withImage: Boolean(upload || picked) }, JSON.stringify(["reply", id, result.messageId]));
    }
    return result;
  });
}

export async function resolve(id: number, operationId?: string) {
  return act(id, { action: "ticket.status_changed", what: "mark Resolved" }, (_actor, audit) =>
    markResolved(ticketsWriterDatabase(), ticketsDatabase(), id, storefrontTicketUrl, sendAppEmail, audit),
    operationId,
  );
}

/**
 * Where the Staff member's browser joins the Ticket's Conversation, or null when the gateway cannot
 * be reached; the Conversation then simply is not live, and Messages still save.
 */
export async function liveUrl(id: number): Promise<string | null> {
  const staff = await requireModule(TICKETS_MODULE);
  if (!canWork(staff)) return null;

  try {
    return await liveConversationUrl(id, staff.username);
  } catch (error) {
    console.error("Live ticket could not be issued", error);

    return null;
  }
}

export type OpenTicketOutcome = OpenTicketResult | { ok: false; reason: "unavailable" | "read-only" };

/** The New ticket dialog: `subject`, `customerId`, optional `orderId`, `priority`, `description` and optional `image`. */
export async function openNewTicket(form: FormData): Promise<OpenTicketOutcome> {
  const staff = await requireModule(TICKETS_MODULE);

  const file = form.get("image");
  const picked = file instanceof File && (file.size > 0 || file.name !== "") ? file : null;
  const orderId = String(form.get("orderId") ?? "");
  const customerId = String(form.get("customerId") ?? "");
  const linkedOrderId = /^\d+$/.test(orderId) ? Number(orderId) : null;
  const denied = async (reason: string) => auditTicketDenied(staff, { type: "customer", id: customerId }, "ticket.opened", "open a Ticket for", reason, undefined, { orderId: linkedOrderId });

  if (!canWork(staff)) {
    await denied(READ_ONLY_REFUSAL.reason);
    return READ_ONLY_REFUSAL;
  }
  try {
    const reference = form.get("attachment");
    const upload = typeof reference === "string" ? await ticketUpload(reference, staff.username, null) : null;
    if (reference !== null && (!upload || picked)) {
      await denied("invalid-attachment");
      return { ok: false, reason: "invalid-attachment" };
    }
    const result = await openTicket(
      ticketsWriterDatabase(),
      ticketsDatabase(),
      { id: staff.username, name: staff.name },
      {
        fileId: upload?.fileId,
        subject: String(form.get("subject") ?? ""),
        customerId,
        orderId: linkedOrderId,
        priority: String(form.get("priority") ?? "normal"),
        description: String(form.get("description") ?? ""),
        image: picked
          ? { filename: picked.name || "image", bytes: new Uint8Array(await picked.arrayBuffer()) }
          : undefined,
      },
      { storefrontTicketUrl, sendEmail: sendAppEmail, storage: gatewayFileStorage, afterSave: after },
    );
    if (result.ok) {
      revalidatePath("/tickets");
      await auditTicketSuccess(staff, { type: "ticket", id: result.id }, "ticket.opened", "opened", { customerId, orderId: linkedOrderId, priority: String(form.get("priority") ?? "normal") }, JSON.stringify(["opened", result.id]));
    } else await denied(result.reason);

    return result;
  } catch (error) {
    console.error("Ticket could not be opened", error);
    await denied("unavailable");

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

/** Backend endpoint for Priority changes; the Tickets Module is checked by act. */
export async function changePriority(id: number, priority: string, operationId?: string) {
  return act(id, { action: "ticket.priority_changed", what: "change the Priority of" }, (_actor, audit) => changeTicketPriority(ticketsWriterDatabase(), id, priority, audit), operationId);
}

/**
 * Puts the Ticket on hold. An optional short Message to the Customer is sent by the Claimer in the same
 * step; if it cannot be sent the hold still stands and `messageSent` is false, so Staff can write it again.
 */
export async function putOnHold(
  id: number,
  request: { reason: string; note?: string; until: string; message?: string },
  operationId?: string,
) {
  const until = new Date(request.until);
  const message = request.message?.trim();
  const hold: HoldRequest = { reason: request.reason, note: request.note, until: Number.isNaN(until.getTime()) ? null : until };

  return act(id, { action: "ticket.put_on_hold", what: "put on hold" }, async (actor, audit) => {
    if (message && message.length > HOLD_MESSAGE_MAX) return { ok: false as const, reason: "note-too-long" as const };
    const result = await putTicketOnHold(ticketsWriterDatabase(), id, actor, hold, audit);
    if (!result.ok || !message) return result;

    const sent = await replyToTicket(ticketsWriterDatabase(), id, actor, message).catch(() => ({ ok: false as const }));

    return { ...result, messageSent: sent.ok };
  }, operationId);
}

export async function takeOffHold(id: number, operationId?: string) {
  return act(id, { action: "ticket.taken_off_hold", what: "take off hold" }, (actor, audit) => takeTicketOffHold(ticketsWriterDatabase(), id, actor, audit), operationId);
}

/** An Internal note: Staff-only text. Any Staff member with the Tickets Module may write one. */
export async function addNote(id: number, body: string) {
  const staff = await requireModule(TICKETS_MODULE);

  const denied = async (reason: string) => auditTicketDenied(staff, { type: "ticket", id }, "ticket.note_added", "add an Internal note to", reason);

  if (!canWork(staff)) {
    await denied(READ_ONLY_REFUSAL.reason);
    return READ_ONLY_REFUSAL;
  }
  try {
    const result = await addInternalNote(ticketsWriterDatabase(), id, { id: staff.username, name: staff.name }, String(body ?? ""));
    // The note text stays in the Conversation; the event holds the message id only.
    if (result.ok) await auditTicketSuccess(staff, { type: "ticket", id }, "ticket.note_added", "added an Internal note to", { messageId: result.messageId }, JSON.stringify(["note", id, result.messageId]));
    else await denied(result.reason);

    return result;
  } catch (error) {
    console.error("Internal note could not be saved", error);
    await denied("unavailable");

    return { ok: false as const, reason: "unavailable" as const };
  }
}

export interface TicketNote {
  id: number;
  authorName: string;
  body: string;
  at: string;
}

/** The Internal notes on one Ticket, for the Tickets drawer. Staff only read Tickets that are theirs or Unclaimed. */
export async function listTicketNotes(id: number): Promise<{ ok: true; notes: TicketNote[] } | { ok: false; reason: "forbidden" | "unavailable" }> {
  const staff = await requireModule(TICKETS_MODULE);

  try {
    const sql = ticketsDatabase();
    const [ticket] = await sql<{ claimed_by_id: string | null }[]>`select claimed_by_id from tickets where id = ${Number(id)}`;
    if (!ticket) return { ok: false, reason: "unavailable" };
    // Staff read only their own and Unclaimed Tickets; an unknown Role reads none.
    const role = shopRole(staff.role);
    if (role === null) return { ok: false, reason: "forbidden" };
    if (role === "staff" && ticket.claimed_by_id !== null && ticket.claimed_by_id !== staff.username) return { ok: false, reason: "forbidden" };

    const rows = await sql<{ id: number; author_name: string | null; body: string; created_at: Date }[]>`
      select id, author_name, body, created_at from ticket_messages
      where ticket_id = ${Number(id)} and internal order by created_at, id`;

    return { ok: true, notes: rows.map((r) => ({ id: r.id, authorName: r.author_name ?? "Staff", body: r.body, at: r.created_at.toISOString() })) };
  } catch (error) {
    console.error("Internal notes could not be read", error);

    return { ok: false, reason: "unavailable" };
  }
}

export type SuggestOutcome =
  | { ok: true; suggestion: SerializedSuggestion }
  | { ok: false; reason: SuggestFailure | "read-only" };
export type ApplyOutcome = { ok: true } | { ok: false; reason: SuggestFailure | "read-only" };

function suggestDeps(staff: { id: string; name: string }): SuggestDeps {
  return { tickets: ticketsWriterDatabase(), crms: crmsDatabase(), audit: gatewayAuditTrail, staff: { id: staff.id, name: staff.name } };
}

/** On demand only: asks the AI for a Category and Priority from the Ticket text. Nothing on the Ticket changes. */
export async function suggestCategoryAndPriority(id: number, operationId: string = randomUUID()): Promise<SuggestOutcome> {
  const staff = await requireModule(TICKETS_MODULE);
  if (!canWork(staff)) return READ_ONLY_REFUSAL;

  try {
    const result = await suggestForTicket(suggestDeps(staff), { id: staff.username, name: staff.name }, Number(id), configuredCompleters(), String(operationId));
    if (!result.ok) return result;
    revalidatePath(`/tickets/${id}`);

    return { ok: true, suggestion: serializeSuggestion(result.suggestion) };
  } catch (error) {
    console.error("Suggestion could not be made", error);

    return { ok: false, reason: "unavailable" };
  }
}

/** Accept (the suggested value) or Change (another one) for Category or Priority; `suggestionId` ties it to the suggestion. */
export async function applySuggestedField(
  id: number,
  field: SuggestField,
  value: string,
  suggestionId: number | null,
  operationId: string = randomUUID(),
): Promise<ApplyOutcome> {
  const staff = await requireModule(TICKETS_MODULE);
  const kind = field === "priority" ? "priority" : "category";
  const action = suggestionId === null ? `ticket.${kind}_changed` : `ticket.ai_${kind}_accepted`;
  const denied = async (reason: string) => auditTicketDenied(staff, { type: "ticket", id }, action, `${suggestionId === null ? "change" : "accept the AI suggestion for"} the ${kind} of`, reason, String(operationId));
  if (!canWork(staff)) {
    await denied(READ_ONLY_REFUSAL.reason);
    return READ_ONLY_REFUSAL;
  }

  try {
    const result = await applyField(
      suggestDeps(staff),
      { id: staff.username, name: staff.name },
      Number(id),
      field === "priority" ? "priority" : "category",
      String(value),
      suggestionId === null ? null : Number(suggestionId),
      String(operationId),
    );
    if (result.ok) revalidatePath(`/tickets/${id}`);
    else await denied(result.reason);

    return result;
  } catch (error) {
    console.error("Category or Priority could not be saved", error);
    await denied("unavailable");

    return { ok: false, reason: "unavailable" };
  }
}

/** Only an explicit Claimer action generates or shortens a Drafted reply. No Ticket or Message changes. */
export async function requestDraftedReply(id: number, request: DraftRequest): Promise<DraftResult> {
  const staff = await requireModule(TICKETS_MODULE);
  const meta = { language: request?.language ?? null, shorter: request?.shorterThanId !== undefined };
  const denied = async (reason: string) => auditTicketDenied(staff, { type: "ticket", id }, "ticket.drafted_reply_requested", "ask for a Drafted reply on", reason, undefined, meta);
  if (!canWork(staff)) {
    await denied("read-only");
    return { ok: false, reason: "Your Role can only view shop work." };
  }
  try {
    const result = await draftReply({ tickets: ticketsDatabase(), crms: crmsDatabase() },
      { id: staff.username, name: staff.name, role: staff.role }, id, request);
    // Nothing is sent: the event records that a draft was asked for (ids only, never its text), until the Claimer sends it.
    if (result.ok) await auditTicketSuccess(staff, { type: "ticket", id }, "ticket.drafted_reply_requested", "asked for a Drafted reply on", { ...meta, draftId: result.draft.id }, JSON.stringify(["drafted-reply-requested", id, result.draft.id]));
    else await denied(result.reason);

    return result;
  } catch {
    await denied("unavailable");
    return { ok: false, reason: "Draft unavailable. You can still write your reply by hand." };
  }
}
