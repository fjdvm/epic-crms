import { createHash } from "node:crypto";

import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { gatewayAuditTrail } from "@/lib/gateway";
import { TICKETS_MODULE } from "@/lib/portal/config";

/**
 * Audit Events for the Tickets and Conversations gaps (#749). Ids and before/after values only in metadata, never
 * message text, notes, hold notes or Customer details. Best effort: recordAudit never throws and never blocks.
 */
const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

type Who = { id: string; name: string };
export type TicketTarget = { type: "ticket" | "customer"; id: number | string | null };

function target(t: TicketTarget) {
  const id = t.id === null || t.id === "" ? "none" : String(t.id);
  return { type: t.type, id, display_name: t.type === "ticket" && id !== "none" ? `TKT-${id}` : id === "none" ? "No target" : `Customer ${id}` };
}

/** A saved change that has no event of its own yet. The operation id must be stable for the action. */
export async function auditTicketSuccess(staff: Who, on: TicketTarget, action: string, change: string, metadata: Record<string, unknown>, operationId: string) {
  const t = target(on);
  await recordAudit(gatewayAuditTrail, {
    module: TICKETS_MODULE, action, outcome: "success", actor: staffAuditActor(staff), target: t,
    description: `${staff.name} ${change} ${t.display_name}.`, metadata,
    occurred_at: new Date().toISOString(), operationId,
  });
}

/**
 * A refused or failed attempt (read-only Role, stale Ticket, validation, unavailable). It uses the success event's action
 * name, outcome `failure`, the reason in the description and metadata, and an identity per person, action and reason
 * (plus the submission token when there is one), so a replayed refusal records once.
 */
export async function auditTicketDenied(staff: Who, on: TicketTarget, action: string, attempt: string, reason: string, token?: string, metadata: Record<string, unknown> = {}) {
  const t = target(on);
  await recordAudit(gatewayAuditTrail, {
    module: TICKETS_MODULE, action, outcome: "failure", actor: staffAuditActor(staff), target: t,
    description: `${staff.name} could not ${attempt} ${t.display_name}: ${reason}`,
    metadata: { ...metadata, reason },
    occurred_at: new Date().toISOString(),
    operationId: `ticket:${t.id}:${action}:denied:${staff.id}:${digest(`${attempt}\n${reason}\n${token ?? ""}\n${JSON.stringify(metadata)}`)}`,
  });
}
