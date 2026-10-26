/** The one CREOMS audit boundary. Modules provide the action; the gateway owns delivery. */
export interface AuditEvent {
  module?: string;
  action: string;
  outcome: "success" | "failure";
  actor: { type: "user" | "process"; id: string; display_name: string };
  target: { type: string; id: string; display_name: string };
  description: string;
  occurred_at: string;
  metadata?: Record<string, unknown>;
  /** Stable identity of this action, including its persisted revision or run when repeatable. */
  operationId: string;
}

export type AuditTrail = (event: AuditEvent) => Promise<void>;

/** Even a throwing fake or alternative adapter must never undo a saved change. */
export async function recordAudit(audit: AuditTrail, event: AuditEvent): Promise<void> {
  try {
    await audit(event);
  } catch (error) {
    console.error("CREOMS Audit Event could not be recorded", error);
  }
}

/** Captures the Staff identity in the shape used by Portal My Logs. */
export function staffAuditActor(staff: { id: string; name: string }): AuditEvent["actor"] {
  return { type: "user", id: staff.id, display_name: staff.name };
}
