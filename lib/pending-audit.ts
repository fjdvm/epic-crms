import { createHash } from "node:crypto";
import type postgres from "postgres";

import type { AuditEvent, AuditTrail } from "@/lib/audit-trail";

/**
 * Pending audit records (#743): money and Manager-approval actions save their Audit Event in `crms.pending_audit_records`
 * (inside the action's own transaction when it has one), deliver it to the Portal afterwards and retry until the gateway
 * accepts it. Delivery never blocks or undoes the action. Retries run from a user action or a server job, never a timer.
 */
type Queryable = postgres.Sql | postgres.TransactionSql;

const SWEEP_LIMIT = 20;

/** The gateway's idempotency identity: the same action on the same Target with the same operation is one record. */
export function pendingAuditKey(event: Pick<AuditEvent, "action" | "target" | "operationId">): string {
  return createHash("sha256").update(JSON.stringify([event.action, event.target.type, event.target.id, event.operationId])).digest("hex");
}

/** Saves the event as pending; a replay of the same operation keeps the original. Pass the action's transaction to commit together. */
export async function savePendingAudit(sql: Queryable, event: AuditEvent): Promise<void> {
  await sql`insert into crms.pending_audit_records (key, event) values (${pendingAuditKey(event)}, ${sql.json(event as unknown as postgres.JSONValue)}) on conflict (key) do nothing`;
}

/**
 * Delivers pending records through `deliver` (which must throw when the gateway does not accept the event).
 * `only` limits it to one record; otherwise the oldest few are tried. A failure leaves the record pending and is
 * counted, never thrown, and a record another caller is delivering is skipped, so each is sent once at a time.
 */
export async function deliverPendingAudits(
  sql: postgres.Sql,
  deliver: AuditTrail,
  options: { only?: Pick<AuditEvent, "action" | "target" | "operationId">; limit?: number } = {},
): Promise<{ delivered: number; failed: number }> {
  const keys = options.only
    ? [pendingAuditKey(options.only)]
    : (await sql<{ key: string }[]>`select key from crms.pending_audit_records where state = 'pending' order by created_at limit ${options.limit ?? SWEEP_LIMIT}`).map(row => row.key);
  const total = { delivered: 0, failed: 0 };
  for (const key of keys) {
    try {
      await sql.begin(async tx => {
        const [record] = await tx<{ event: AuditEvent }[]>`select event from crms.pending_audit_records where key = ${key} and state = 'pending' for update skip locked`;
        if (!record) return;
        try {
          await deliver(record.event);
          await tx`update crms.pending_audit_records set state = 'delivered', attempts = attempts + 1, last_error = null, last_attempt_at = now(), delivered_at = now() where key = ${key}`;
          total.delivered++;
        } catch (error) {
          const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
          await tx`update crms.pending_audit_records set attempts = attempts + 1, last_error = ${message}, last_attempt_at = now() where key = ${key}`;
          total.failed++;
        }
      });
    } catch (error) {
      console.error("A pending audit record could not be delivered", error);
      total.failed++;
    }
  }
  return total;
}
