import type postgres from "postgres";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { canManage } from "@/lib/portal/roles";

import {
  DEFAULT_HISTORY,
  MAX_TARGET_HOURS,
  serviceLevel,
  targetsAt,
  type ClockInput,
  type ServiceLevel,
  type ServiceTargets,
  type TargetHistory,
} from "./service-level";

type Staff = { id: string; name: string; role: string };
type Result = { ok: true; targets: ServiceTargets } | { ok: false; reason: string };

/** Every pair ever saved, oldest first; a Ticket takes the one in force when it was opened. */
export async function loadTargetHistory(sql: postgres.Sql): Promise<TargetHistory> {
  const rows = await sql<{ effective_from: Date; first_reply_hours: number; resolve_hours: number }[]>`
    select effective_from, first_reply_hours, resolve_hours from crms.service_level_changes
    order by effective_from, id`;

  return rows.length
    ? rows.map((r) => ({ effectiveFrom: r.effective_from, firstReplyHours: r.first_reply_hours, resolveHours: r.resolve_hours }))
    : DEFAULT_HISTORY;
}

/** The pair in force now. */
export async function currentTargets(sql: postgres.Sql): Promise<ServiceTargets> {
  return targetsAt(await loadTargetHistory(sql), new Date());
}

const wholeHours = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 1 && (n as number) <= MAX_TARGET_HOURS;

/**
 * A Manager saves the two targets. It adds a row rather than changing one, so Tickets already opened keep
 * their pair. The row records who and what it replaced, and the change is sent to the Audit service.
 */
export async function setServiceTargets(
  sql: postgres.Sql,
  audit: AuditTrail,
  staff: Staff,
  input: { firstReplyHours: unknown; resolveHours: unknown },
): Promise<Result> {
  if (!canManage(staff)) return { ok: false, reason: "Only a Manager can change the Service levels." };
  if (!wholeHours(input.firstReplyHours) || !wholeHours(input.resolveHours))
    return { ok: false, reason: `Enter whole hours from 1 to ${MAX_TARGET_HOURS}.` };
  if (input.resolveHours < input.firstReplyHours)
    return { ok: false, reason: "The resolve target cannot be shorter than the first reply target." };

  const { firstReplyHours, resolveHours } = input;

  const change = await sql.begin(async (tx) => {
    const [previous] = await tx<{ first_reply_hours: number; resolve_hours: number }[]>`
      select first_reply_hours, resolve_hours from crms.service_level_changes
      order by effective_from desc, id desc limit 1 for update`;
    const [row] = await tx<{ id: string }[]>`
      insert into crms.service_level_changes
        (first_reply_hours, resolve_hours, previous_first_reply_hours, previous_resolve_hours, changed_by_id, changed_by_name)
      values (${firstReplyHours}, ${resolveHours}, ${previous?.first_reply_hours ?? null}, ${previous?.resolve_hours ?? null},
        ${staff.id}, ${staff.name})
      returning id`;

    return { id: row.id, previous };
  });

  await recordAudit(audit, {
    module: TICKETS_MODULE,
    action: "service_levels.changed",
    outcome: "success",
    actor: staffAuditActor(staff),
    target: { type: "setting", id: "service-levels", display_name: "Service levels" },
    description: `${staff.name} changed the Service levels to ${firstReplyHours} h first reply, ${resolveHours} h resolve.`,
    occurred_at: new Date().toISOString(),
    metadata: {
      previousFirstReplyHours: change.previous?.first_reply_hours ?? null,
      previousResolveHours: change.previous?.resolve_hours ?? null,
      firstReplyHours,
      resolveHours,
    },
    operationId: `service-levels:${change.id}`,
  });

  return { ok: true, targets: { firstReplyHours, resolveHours } };
}

/** What the loaders need to put a countdown on a Ticket: the saved pairs and where misses are stamped. */
export interface ServiceLevels {
  history: TargetHistory;
  /** Where misses are stamped; without it the countdown still shows, unstamped. */
  sql?: postgres.Sql;
}

export interface ClockTicket {
  id: number;
  createdAt: Date;
  input: Omit<ClockInput, "createdAt" | "stamped">;
}

/**
 * The countdown of each Ticket. A missed target is stamped the first time it is seen and never
 * cleared, so it stays Missed after anything changes. Stamps are a record, not a gate: if they
 * cannot be read or saved the countdown still shows, worked out from the Messages and holds.
 */
export async function withServiceLevels(
  levels: ServiceLevels,
  tickets: ClockTicket[],
  now: Date,
): Promise<Map<number, ServiceLevel>> {
  const stamps = new Map<number, { firstReply: boolean; resolve: boolean }>();

  if (tickets.length && levels.sql) {
    try {
      const rows = await levels.sql<{ ticket_id: number; kind: string }[]>`
        select ticket_id, kind from crms.ticket_service_misses where ticket_id = any(${tickets.map((t) => t.id)}::int[])`;

      for (const r of rows) {
        const stamp = stamps.get(r.ticket_id) ?? { firstReply: false, resolve: false };
        if (r.kind === "first_reply") stamp.firstReply = true;
        else stamp.resolve = true;
        stamps.set(r.ticket_id, stamp);
      }
    } catch (error) {
      console.error("Service level misses could not be read", error);
    }
  }

  const result = new Map<number, ServiceLevel>();
  const fresh: { id: number; kind: "first_reply" | "resolve" }[] = [];

  for (const t of tickets) {
    const stamped = stamps.get(t.id);
    const level = serviceLevel(
      { ...t.input, createdAt: t.createdAt, stamped },
      targetsAt(levels.history, t.createdAt),
      now,
    );

    result.set(t.id, level);
    if (level.firstReply.state === "missed" && !stamped?.firstReply) fresh.push({ id: t.id, kind: "first_reply" });
    if (level.resolve.state === "missed" && !stamped?.resolve) fresh.push({ id: t.id, kind: "resolve" });
  }

  if (fresh.length && levels.sql) {
    try {
      await levels.sql`insert into crms.ticket_service_misses (ticket_id, kind)
        select * from unnest(${fresh.map((m) => m.id)}::int[], ${fresh.map((m) => m.kind)}::text[])
        on conflict do nothing`;
    } catch (error) {
      console.error("Service level misses could not be stamped", error);
    }
  }

  return result;
}

/** The saved pairs and the stamp table, read live; null when CREOMS's own database cannot be reached. */
export async function readServiceLevels(connect: () => postgres.Sql): Promise<ServiceLevels | null> {
  try {
    const sql = connect();

    return { history: await loadTargetHistory(sql), sql };
  } catch (error) {
    console.error("Service levels could not be read", error);

    return null;
  }
}
