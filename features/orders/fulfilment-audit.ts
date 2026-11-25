import { createHash } from "node:crypto";

import { recordAudit, staffAuditActor, type AuditEvent } from "@/lib/audit-trail";
import { crmsDatabase } from "@/lib/crms-db";
import { deliverGatewayAuditEvent, gatewayAuditTrail } from "@/lib/gateway";
import { deliverPendingAudits, savePendingAudit } from "@/lib/pending-audit";
import { FULFILMENT_MODULE } from "@/lib/portal/config";
import type { Staff } from "@/lib/portal/client";

/** Audit Events for failed delivery and cancellation after dispatch (#746). Ids and before/after values only, never free text. */
const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

function fulfilmentEvent(orderId: number, staff: Staff, action: string, description: string, metadata: Record<string, unknown>, operationId: string, outcome: "success" | "failure" = "success"): AuditEvent {
  return {
    action, module: FULFILMENT_MODULE, outcome, actor: staffAuditActor(staff),
    target: { type: "order", id: String(orderId), display_name: `Order #${orderId}` },
    description, metadata, occurred_at: new Date().toISOString(), operationId,
  };
}

/** A saved change. `durable` (money, stock and Manager approvals) saves a pending audit record first, as in #743. */
export async function auditFulfilment(orderId: number, staff: Staff, action: string, description: string, metadata: Record<string, unknown>, identity: string, durable = false) {
  const event = fulfilmentEvent(orderId, staff, action, description, metadata, `order:${orderId}:${action}:${identity}`);
  if (!durable) return recordAudit(gatewayAuditTrail, event);
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

/** A refused or failed attempt: the same person refused for the same reason on the same Order keeps one identity. */
export async function auditFulfilmentDenied(orderId: number, staff: Staff, action: string, attempt: string, reason: string, metadata: Record<string, unknown> = {}) {
  await recordAudit(gatewayAuditTrail, fulfilmentEvent(orderId, staff, action, `${staff.name} could not ${attempt} Order #${orderId}: ${reason}`,
    { ...metadata, reason }, `order:${orderId}:${action}:denied:${staff.id}:${digest(`${attempt}\n${JSON.stringify(metadata)}\n${reason}`)}`, "failure"));
}
