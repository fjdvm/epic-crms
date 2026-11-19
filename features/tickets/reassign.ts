import type postgres from "postgres";
import { customerNameSql } from "@/lib/deleted-customer";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";

import type { ReassignDetail } from "@/features/notifications/notifications";

import { REASON_MAX } from "./reassign-refusals";

export { REASON_MAX };

/** The Manager moving the work: `id` is their Portal id, `username` is how Tickets name Staff. */
export interface Mover {
  id: string;
  name: string;
  username: string;
  role: string;
}

/** A Staff member who can take Tickets, from the Portal staff directory. */
export interface Teammate {
  /** The Portal username, which is what a Ticket stores as its Claimer. */
  id: string;
  name: string;
  role: "staff" | "manager";
}

import type { ReassignFailure } from "./reassign-refusals";

export type { ReassignFailure };

export type ReassignResult =
  | { ok: true; moved: number[]; skipped: number[] }
  | { ok: false; reason: ReassignFailure };

export interface ReassignRequest {
  ticketIds: number[];
  /** The Claimer the Manager saw; a Ticket held by anyone else is left alone. Empty assigns an Unclaimed Ticket. */
  fromId: string;
  to: Teammate;
  reason: string;
  operationId: string;
  bulk: boolean;
  /** The Customer a single-Ticket alert names; unused for a bulk move. */
  customer?: { id: string; name: string } | null;
}

export interface ReassignDeps {
  /** The ecommerce database as `creoms_tickets`; owns the Claimer. */
  tickets: postgres.Sql;
  /** CREOMS's own `crms` schema; owns the history and the alerts. */
  crms: postgres.Sql;
  audit: AuditTrail;
}

/**
 * A Manager moves Tickets from the Claimer they saw to a named Staff member. The move only touches a
 * Ticket still held by that Claimer, so a lost race moves nothing and says why. Each moved Ticket gets
 * an activity row and an audit event; the previous and the new Claimer each get one alert with the reason.
 */
export async function reassignTickets(deps: ReassignDeps, mover: Mover, req: ReassignRequest): Promise<ReassignResult> {
  if (shopRole(mover.role) !== "manager") return { ok: false, reason: "forbidden" };

  const reason = req.reason?.trim() ?? "";
  if (!reason) return { ok: false, reason: "reason-required" };
  if ([...reason].length > REASON_MAX) return { ok: false, reason: "reason-too-long" };
  if (!req.to?.id || !req.to.name?.trim() || !["staff", "manager"].includes(req.to.role))
    return { ok: false, reason: "invalid-recipient" };
  const ids = [...new Set(req.ticketIds)].filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!ids.length) return { ok: false, reason: "nothing-to-move" };
  if (req.to.id === req.fromId) return { ok: false, reason: "unchanged" };

  // A retry of the same operation replays what it already did.
  const earlier = await deps.crms<{ ticket_id: number }[]>`
    select ticket_id from crms.ticket_reassignments
    where operation_id = ${req.operationId} and moved_by_id = ${mover.id} order by ticket_id`;
  if (earlier.length) return { ok: true, moved: earlier.map((r) => r.ticket_id), skipped: [] };

  const unclaimed = !req.fromId;
  const rows = await deps.tickets<{ id: number; from_name: string }[]>`
    with held as (
      select id, claimed_by_name from tickets
      where id = any(${ids}::int[]) and claimed_by_id is not distinct from ${req.fromId || null}::text and status <> 'completed'
      for update
    )
    update tickets t set claimed_by_id = ${req.to.id}, claimed_by_name = ${req.to.name}
    from held where t.id = held.id
    returning t.id, held.claimed_by_name as from_name`;

  if (!rows.length) return { ok: false, reason: await whyNothingMoved(deps.tickets, ids, unclaimed) };

  const moved = rows.map((r) => r.id).sort((a, b) => a - b);
  const skipped = ids.filter((id) => !moved.includes(id));
  const fromName = unclaimed ? "Unclaimed" : (rows[0].from_name ?? "the previous Claimer");

  try {
    await recordMoves(deps.crms, mover, req, reason, moved, fromName);
  } catch (error) {
    // The Claimer already changed on the Ticket; the history and alerts are retried by repeating the operation.
    console.error("Reassign history and alerts could not be saved", error);
  }

  await Promise.all(
    moved.map((id) =>
      recordAudit(deps.audit, {
        module: TICKETS_MODULE,
        action: "ticket.reassigned",
        outcome: "success",
        actor: staffAuditActor(mover),
        target: { type: "ticket", id: String(id), display_name: `TKT-${id}` },
        description: `${mover.name} moved TKT-${id} from ${fromName} to ${req.to.name}. Reason: ${reason}`,
        occurred_at: new Date().toISOString(),
        metadata: { fromId: req.fromId, fromName, toId: req.to.id, toName: req.to.name, reason, bulk: req.bulk },
        operationId: JSON.stringify([mover.id, req.operationId, id]),
      }),
    ),
  );

  return { ok: true, moved, skipped };
}

async function whyNothingMoved(sql: postgres.Sql, ids: number[], unclaimed = false): Promise<ReassignFailure> {
  const found = await sql<{ status: string; claimed_by_id: string | null }[]>`
    select status, claimed_by_id from tickets where id = any(${ids}::int[])`;

  if (!found.length) return "not-found";
  if (found.every((t) => t.status === "completed")) return "completed";
  if (!unclaimed && found.every((t) => t.claimed_by_id === null)) return "not-claimed";

  return "claimer-changed";
}

async function recordMoves(
  crms: postgres.Sql,
  mover: Mover,
  req: ReassignRequest,
  reason: string,
  moved: number[],
  fromName: string,
) {
  await crms.begin(async (tx) => {
    await tx`
      insert into crms.ticket_reassignments
        (ticket_id, from_id, from_name, to_id, to_name, reason, moved_by_id, moved_by_name, operation_id, bulk)
      select id, ${req.fromId || "unclaimed"}, ${fromName}, ${req.to.id}, ${req.to.name}, ${reason}, ${mover.id}, ${mover.name}, ${req.operationId}, ${req.bulk}
      from unnest(${moved}::int[]) as id
      on conflict (operation_id, ticket_id) do nothing`;

    const alert = (recipientId: string, side: ReassignDetail["side"]) => {
      if (recipientId === mover.username) return null;
      const detail: ReassignDetail = { side, from: fromName, to: req.to.name, by: mover.name, reason, count: moved.length };

      return tx`
        insert into crms.notifications (kind, customer_id, customer_name, ticket_id, recipient_id, detail)
        values ('ticket-reassigned', ${req.bulk ? "" : (req.customer?.id ?? "")}, ${req.bulk ? "" : (req.customer?.name ?? "")},
          ${moved.length === 1 ? moved[0] : null}, ${recipientId}, ${tx.json(detail as unknown as import("postgres").JSONValue)})`;
    };

    if (req.fromId) await alert(req.fromId, "previous");
    await alert(req.to.id, "new");
  });
}

export interface ReassignmentRecord {
  id: number;
  fromName: string;
  toName: string;
  reason: string;
  movedByName: string;
  at: Date;
}

/** Every move of one Ticket, newest first: the Ticket's activity, and what Admin and CEO read. */
export async function listReassignments(crms: postgres.Sql, ticketId: number): Promise<ReassignmentRecord[]> {
  const rows = await crms<{ id: string; from_name: string; to_name: string; reason: string; moved_by_name: string; created_at: Date }[]>`
    select id::text, from_name, to_name, reason, moved_by_name, created_at
    from crms.ticket_reassignments where ticket_id = ${ticketId} order by created_at desc, id desc`;

  return rows.map((r) => ({
    id: Number(r.id), fromName: r.from_name, toName: r.to_name, reason: r.reason, movedByName: r.moved_by_name, at: r.created_at,
  }));
}

/** Open Tickets (not Completed) each Claimer holds, so the Manager sees who is busy. */
export async function claimerWorkload(sql: postgres.Sql): Promise<Map<string, number>> {
  const rows = await sql<{ claimed_by_id: string; n: number }[]>`
    select claimed_by_id, count(*)::int as n from tickets
    where claimed_by_id is not null and status <> 'completed' group by claimed_by_id`;

  return new Map(rows.map((r) => [r.claimed_by_id, r.n]));
}

export interface AbsentTicket {
  id: number;
  subject: string;
  customerName: string;
  status: string;
}

/** The Tickets an absent teammate holds that a bulk move would take. */
export async function ticketsHeldBy(sql: postgres.Sql, claimerId: string): Promise<AbsentTicket[]> {
  const rows = await sql<{ id: number; subject: string; full_name: string; status: string }[]>`
    select t.id, t.subject, ${sql.unsafe(customerNameSql('c'))} as full_name, t.status from tickets t join customers c on c.id = t.customer_id
    where t.claimed_by_id = ${claimerId} and t.status <> 'completed' order by t.id`;

  return rows.map((r) => ({ id: r.id, subject: r.subject, customerName: r.full_name, status: r.status }));
}
