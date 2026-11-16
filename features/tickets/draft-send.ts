import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";
import type { DraftActor, DraftDeps } from "./draft";
import type { ReplyResult, TicketAudit } from "./ticket-actions";

export type DraftSendResult = ReplyResult | { ok: false; reason: "invalid-draft" };

/** The normal send boundary, with optional server-verified provenance. Drafting never calls it.
 * The normal sender still atomically checks the current Claimer before inserting the Message.
 */
export async function sendWithDraft(
  deps: DraftDeps,
  actor: DraftActor,
  ticketId: number,
  body: string,
  draftId: number | null,
  send: () => Promise<ReplyResult>,
  audit: TicketAudit,
): Promise<DraftSendResult> {
  if (draftId === null) return send();
  const role = shopRole(actor.role);
  if ((role !== "staff" && role !== "manager") || !Number.isSafeInteger(draftId) || draftId <= 0)
    return { ok: false, reason: "invalid-draft" };
  const [draft] = await deps.crms`select reply from crms.ticket_drafts
    where id = ${draftId} and ticket_id = ${ticketId} and requested_by_id = ${actor.id} and reply is not null`;
  if (!draft) return { ok: false, reason: "invalid-draft" };
  const result = await send();
  if (!result.ok) return result;
  const decision = body.trim() === draft.reply ? "sent as drafted" : "sent as edited";
  await recordAudit(audit.trail, {
    module: TICKETS_MODULE, action: "ticket.drafted_reply_sent", outcome: "success",
    actor: staffAuditActor(audit.staff), target: { type: "ticket", id: String(ticketId), display_name: `TKT-${ticketId}` },
    description: `${actor.name} ${decision} on Ticket TKT-${ticketId}.`,
    metadata: { draftId, messageId: result.messageId, decision },
    occurred_at: new Date().toISOString(), operationId: JSON.stringify(["drafted-reply", ticketId, result.messageId]),
  });
  return result;
}
