import { createHash } from "node:crypto";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";

/**
 * Audit Events for Commerce Settings that did not change anything (#753): a refused Role, a value that did not
 * validate, a clash, or a save that threw. Successful changes record their own event with the before and after values.
 * Metadata holds the setting id and the fixed reason only, never what was typed (an account number, a name).
 * Best effort: recordAudit never throws, so an Audit failure never changes the result.
 */
type Staff = { id: string; name: string; role: string };
type Outcome = { ok: true } | { ok: false; reason: string };

export type SettingSpec = {
  module: string;
  /** The same action name as the success event; the outcome tells them apart. */
  action: string;
  target: { type: string; id: string; display_name: string };
  /** Plain words for the description: "change the payment window". */
  what: string;
};

/** A short stable fingerprint of what makes an action the same action, so a replay maps to one Audit Event. */
export function fingerprint(...parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
}

/** The minute a request arrived in; a replayed or retried request inside it keeps the same identity. */
export const minuteOf = (now: Date) => Math.floor(now.getTime() / 60_000);

export async function auditSettingFailure(audit: AuditTrail, staff: Staff, spec: SettingSpec, reason: string, now = new Date()) {
  await recordAudit(audit, {
    module: spec.module, action: spec.action, outcome: "failure", actor: staffAuditActor(staff), target: spec.target,
    description: `${staff.name} could not ${spec.what}: ${reason}`,
    occurred_at: now.toISOString(), metadata: { setting: spec.target.id, reason },
    operationId: `${spec.action}:failure:${staff.id}:${spec.target.id}:${fingerprint(reason)}:${minuteOf(now)}`,
  });
}

/**
 * Runs one Commerce Settings change and records the refusal or failure it ends in. A throw is recorded as
 * "unavailable" and rethrown, so the Server Action still shows its own message.
 */
export async function withFailureAudit<R extends Outcome>(audit: AuditTrail, staff: Staff, spec: SettingSpec, run: () => Promise<R>): Promise<R> {
  let result: R;
  try { result = await run(); } catch (error) {
    await auditSettingFailure(audit, staff, spec, "unavailable");
    throw error;
  }
  if (!result.ok) await auditSettingFailure(audit, staff, spec, result.reason);
  return result;
}
