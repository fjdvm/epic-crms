import { createHash } from "node:crypto";

import { recordAudit, staffAuditActor, type AuditEvent } from "@/lib/audit-trail";
import { crmsDatabase } from "@/lib/crms-db";
import { deliverGatewayAuditEvent, gatewayAuditTrail } from "@/lib/gateway";
import { deliverPendingAudits, savePendingAudit } from "@/lib/pending-audit";
import { RETURNS_MODULE } from "@/lib/portal/config";
import type { Staff } from "@/lib/portal/client";

/** Audit Events for the Returns gaps (#747). Ids and before/after values only in metadata; refusals add the reason. */
const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

export type ReturnsTarget = { type: "return" | "order"; id: number };
const label = (target: ReturnsTarget) => (target.type === "return" ? `RMA-${target.id}` : `Order #${target.id}`);

function returnsEvent(target: ReturnsTarget, staff: Staff, action: string, description: string, metadata: Record<string, unknown> | undefined, operationId: string, outcome: "success" | "failure"): AuditEvent {
  return {
    action, module: RETURNS_MODULE, outcome, actor: staffAuditActor(staff),
    target: { type: target.type, id: String(target.id), display_name: label(target) },
    description, ...(metadata ? { metadata } : {}), occurred_at: new Date().toISOString(), operationId,
  };
}

/**
 * A saved change that moves money, removes stock or follows a Manager approval is saved as a pending audit record first (#743);
 * if that cannot be saved the event falls back to the best-effort path. The operation id makes a replay one event.
 */
export async function auditReturnsDurable(target: ReturnsTarget, staff: Staff, action: string, description: string, metadata: Record<string, unknown> | undefined, operationId: string) {
  const event = returnsEvent(target, staff, action, description, metadata, operationId, "success");
  try {
    await savePendingAudit(crmsDatabase(), event);
  } catch (error) {
    console.error("The pending audit record could not be saved", error);
    return recordAudit(gatewayAuditTrail, event);
  }
  try {
    await deliverPendingAudits(crmsDatabase(), deliverGatewayAuditEvent);
  } catch (error) {
    console.error("Pending audit records could not be delivered", error);
  }
}

/** A refused or failed attempt: the same person refused for the same reason on the same Target keeps one identity. */
export async function auditReturnsDenied(target: ReturnsTarget, staff: Staff, action: string, attempt: string, reason: string, metadata: Record<string, unknown> = {}) {
  await recordAudit(gatewayAuditTrail, returnsEvent(target, staff, action, `${staff.name} could not ${attempt} ${label(target)}: ${reason}`,
    { ...metadata, reason }, `${target.type}:${target.id}:${action}:denied:${staff.id}:${digest(`${attempt}\n${JSON.stringify(metadata)}\n${reason}`)}`, "failure"));
}
