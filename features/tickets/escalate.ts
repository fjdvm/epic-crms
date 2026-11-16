import type postgres from "postgres";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";

import { reassignTickets, type Mover } from "./reassign";
import {
  ESCALATION_NOTE_MAX,
  ESCALATION_REASONS,
  escalationReasonLabel,
  type EscalateFailure,
  type EscalationReason,
} from "./escalate-reasons";

export type EscalateResult<T = object> = ({ ok: true } & T) | { ok: false; reason: EscalateFailure };

/** The person acting: `id` is their Portal id, `username` is how Tickets name Staff. */
export type Actor = Mover;

export interface EscalateDeps {
  /** The ecommerce database as `creoms_tickets`; owns the Claimer. */
  tickets: postgres.Sql;
  /** CREOMS's own `crms` schema; owns the escalations and the alerts. */
  crms: postgres.Sql;
  audit: AuditTrail;
}

/** A Manager who holds the Tickets Module, from the Portal staff directory. */
export interface ManagerRecipient {
  /** The Portal username, which is what an alert is addressed to. */
  username: string;
  name: string;
}

export interface EscalationRecord {
  id: number;
  reason: EscalationReason;
  note: string;
  escalatedByName: string;
  at: Date;
  resolution: "taken" | "sent_back" | null;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: Date | null;
}

type Row = {
  id: string;
  reason: EscalationReason;
  note: string;
  escalated_by_name: string;
  created_at: Date;
  resolution: "taken" | "sent_back" | null;
  resolution_note: string | null;
  resolved_by_name: string | null;
  resolved_at: Date | null;
};

const toRecord = (r: Row): EscalationRecord => ({
  id: Number(r.id),
  reason: r.reason,
  note: r.note,
  escalatedByName: r.escalated_by_name,
  at: r.created_at,
  resolution: r.resolution,
  resolutionNote: r.resolution_note,
  resolvedByName: r.resolved_by_name,
  resolvedAt: r.resolved_at,
});

/** Every escalation of one Ticket, newest first: the Ticket's activity. The open one has no resolution. */
export async function listEscalations(crms: postgres.Sql, ticketId: number): Promise<EscalationRecord[]> {
  const rows = await crms<Row[]>`
    select id::text, reason, note, escalated_by_name, created_at, resolution, resolution_note, resolved_by_name, resolved_at
    from crms.ticket_escalations where ticket_id = ${ticketId} order by created_at desc, id desc`;

  return rows.map(toRecord);
}

/** The Tickets that are Escalated now, for the list's badge and filter. */
export async function openEscalatedIds(crms: postgres.Sql): Promise<number[]> {
  const rows = await crms<{ ticket_id: number }[]>`select ticket_id from crms.ticket_escalations where resolved_at is null`;

  return rows.map((r) => r.ticket_id);
}

function validNote(raw: string | undefined): { note: string } | { failure: EscalateFailure } {
  const note = raw?.trim() ?? "";
  if (!note) return { failure: "note-required" };
  if ([...note].length > ESCALATION_NOTE_MAX) return { failure: "note-too-long" };

  return { note };
}

/**
 * The Claimer asks a Manager for help with one reason and a short note. Every Manager with the Tickets
 * Module gets an alert (never the person escalating); the Claimer stays on the Ticket. Nothing escalates
 * by itself, and a retry of the same operation replays.
 */
export async function escalateTicket(
  deps: EscalateDeps,
  actor: Actor,
  ticketId: number,
  input: { reason: EscalationReason; note: string },
  managers: ManagerRecipient[],
  operationId: string,
): Promise<EscalateResult<{ alerted: number }>> {
  if (!ESCALATION_REASONS.some((r) => r.value === input.reason)) return { ok: false, reason: "invalid-reason" };
  const checked = validNote(input.note);
  if ("failure" in checked) return { ok: false, reason: checked.failure };
  const { note } = checked;

  const [ticket] = await deps.tickets<{ status: string; claimed_by_id: string | null; customer_id: string; full_name: string }[]>`
    select t.status, t.claimed_by_id, c.id as customer_id, c.full_name
    from tickets t join customers c on c.id = t.customer_id where t.id = ${ticketId}`;
  if (!ticket) return { ok: false, reason: "not-found" };
  if (ticket.status === "completed") return { ok: false, reason: "completed" };
  if (ticket.claimed_by_id !== actor.username) return { ok: false, reason: "not-claimer" };

  const recipients = managers.filter((m) => m.username !== actor.username);
  const detail = { reason: input.reason, note, by: actor.name };

  const alerted = await deps.crms.begin(async (tx) => {
    const [replay] = await tx`select 1 from crms.ticket_escalations where escalated_by_id = ${actor.id} and operation_id = ${operationId}`;
    if (replay) return null;

    const inserted = await tx`
      insert into crms.ticket_escalations (ticket_id, reason, note, escalated_by_id, escalated_by_name, operation_id)
      values (${ticketId}, ${input.reason}, ${note}, ${actor.id}, ${actor.name}, ${operationId})
      on conflict do nothing returning id`;
    if (!inserted.length) return "already" as const;

    for (const m of recipients) {
      await tx`
        insert into crms.notifications (kind, customer_id, customer_name, ticket_id, recipient_id, detail)
        values ('ticket-escalated', ${ticket.customer_id}, ${ticket.full_name}, ${ticketId}, ${m.username}, ${tx.json(detail)})`;
    }

    return recipients.length;
  });

  if (alerted === "already") return { ok: false, reason: "already-escalated" };
  if (alerted === null) return { ok: true, alerted: recipients.length };

  await recordAudit(deps.audit, {
    module: TICKETS_MODULE,
    action: "ticket.escalated",
    outcome: "success",
    actor: staffAuditActor(actor),
    target: { type: "ticket", id: String(ticketId), display_name: `TKT-${ticketId}` },
    description: `${actor.name} escalated TKT-${ticketId} to the Managers (${escalationReasonLabel(input.reason)}). Note: ${note}`,
    occurred_at: new Date().toISOString(),
    metadata: { reason: input.reason, note, alerted: recipients.length },
    operationId: JSON.stringify([actor.id, operationId, ticketId]),
  });

  return { ok: true, alerted: recipients.length };
}

async function openEscalation(crms: postgres.Sql, ticketId: number) {
  const [row] = await crms<{ id: string; escalated_by_id: string }[]>`
    select id::text, escalated_by_id from crms.ticket_escalations where ticket_id = ${ticketId} and resolved_at is null`;

  return row ?? null;
}

async function closeEscalation(
  crms: postgres.Sql,
  id: string,
  manager: Actor,
  resolution: "taken" | "sent_back",
  note: string | null,
) {
  await crms`
    update crms.ticket_escalations
    set resolution = ${resolution}, resolution_note = ${note}, resolved_by_id = ${manager.id}, resolved_by_name = ${manager.name}, resolved_at = now()
    where id = ${id}::bigint and resolved_at is null`;
}

/**
 * A Manager takes an escalated Ticket and becomes its Claimer, through the same move as Reassign
 * (so the previous Claimer is told and the move is in the Ticket's activity). Closes the escalation.
 */
export async function takeEscalation(deps: EscalateDeps, manager: Actor, ticketId: number, operationId: string): Promise<EscalateResult> {
  if (shopRole(manager.role) !== "manager") return { ok: false, reason: "forbidden" };

  const open = await openEscalation(deps.crms, ticketId);
  if (!open) return { ok: false, reason: "not-escalated" };

  const [ticket] = await deps.tickets<{ status: string; claimed_by_id: string | null; customer_id: string; full_name: string }[]>`
    select t.status, t.claimed_by_id, c.id as customer_id, c.full_name
    from tickets t join customers c on c.id = t.customer_id where t.id = ${ticketId}`;
  if (!ticket) return { ok: false, reason: "not-found" };
  if (ticket.status === "completed") return { ok: false, reason: "completed" };
  if (!ticket.claimed_by_id) return { ok: false, reason: "not-claimed" };

  if (ticket.claimed_by_id !== manager.username) {
    const moved = await reassignTickets(
      { tickets: deps.tickets, crms: deps.crms, audit: deps.audit },
      manager,
      {
        ticketIds: [ticketId],
        fromId: ticket.claimed_by_id,
        to: { id: manager.username, name: manager.name, role: "manager" },
        reason: "Took over the escalation",
        operationId: `take:${operationId}`,
        bulk: false,
        customer: { id: ticket.customer_id, name: ticket.full_name },
      },
    );
    if (!moved.ok) return { ok: false, reason: moved.reason === "unchanged" ? "claimer-changed" : (moved.reason as EscalateFailure) };
  }

  await closeEscalation(deps.crms, open.id, manager, "taken", null);
  await recordAudit(deps.audit, {
    module: TICKETS_MODULE,
    action: "ticket.escalation-taken",
    outcome: "success",
    actor: staffAuditActor(manager),
    target: { type: "ticket", id: String(ticketId), display_name: `TKT-${ticketId}` },
    description: `${manager.name} took TKT-${ticketId} after an escalation.`,
    occurred_at: new Date().toISOString(),
    metadata: { escalationId: open.id },
    operationId: JSON.stringify([manager.id, operationId, ticketId, "take"]),
  });

  return { ok: true };
}

/** A Manager sends an escalated Ticket back to its Claimer with a required note; the Claimer is alerted. */
export async function sendBackEscalation(
  deps: EscalateDeps,
  manager: Actor,
  ticketId: number,
  rawNote: string,
  operationId: string,
): Promise<EscalateResult> {
  if (shopRole(manager.role) !== "manager") return { ok: false, reason: "forbidden" };
  const checked = validNote(rawNote);
  if ("failure" in checked) return { ok: false, reason: checked.failure };
  const { note } = checked;

  const [ticket] = await deps.tickets<{ claimed_by_id: string | null; customer_id: string; full_name: string }[]>`
    select t.claimed_by_id, c.id as customer_id, c.full_name
    from tickets t join customers c on c.id = t.customer_id where t.id = ${ticketId}`;
  if (!ticket) return { ok: false, reason: "not-found" };

  const closed = await deps.crms.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update crms.ticket_escalations
      set resolution = 'sent_back', resolution_note = ${note}, resolved_by_id = ${manager.id}, resolved_by_name = ${manager.name}, resolved_at = now()
      where ticket_id = ${ticketId} and resolved_at is null returning id::text`;
    if (!rows.length) return false;

    if (ticket.claimed_by_id && ticket.claimed_by_id !== manager.username) {
      await tx`
        insert into crms.notifications (kind, customer_id, customer_name, ticket_id, recipient_id, detail)
        values ('ticket-sent-back', ${ticket.customer_id}, ${ticket.full_name}, ${ticketId}, ${ticket.claimed_by_id}, ${tx.json({ by: manager.name, note })})`;
    }

    return true;
  });
  if (!closed) return { ok: false, reason: "not-escalated" };

  await recordAudit(deps.audit, {
    module: TICKETS_MODULE,
    action: "ticket.escalation-sent-back",
    outcome: "success",
    actor: staffAuditActor(manager),
    target: { type: "ticket", id: String(ticketId), display_name: `TKT-${ticketId}` },
    description: `${manager.name} sent TKT-${ticketId} back to its Claimer. Note: ${note}`,
    occurred_at: new Date().toISOString(),
    metadata: { note },
    operationId: JSON.stringify([manager.id, operationId, ticketId, "send-back"]),
  });

  return { ok: true };
}
