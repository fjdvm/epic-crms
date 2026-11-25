import { createHash } from "node:crypto";

import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { gatewayAuditTrail } from "@/lib/gateway";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";

/**
 * Audit Events for the Customer Profiles gaps (#751): refused or failed note and Task attempts, and the notes read.
 * Metadata holds ids and the reason only, never note text, Task text or Customer details. Best effort: recordAudit
 * never throws and never blocks. CREOMS has no Customer edit or merge action yet; when built they join here.
 */
const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
type Who = { id: string; name: string };

const target = (customerId: unknown) => {
  const id = typeof customerId === "string" && customerId.trim() ? customerId.slice(0, 200) : "none";
  return { type: "customer_profile", id, display_name: id === "none" ? "No Customer" : `Customer ${id}` };
};

/**
 * Same action name as the success event, outcome `failure`, the reason in the description. The identity is per person,
 * action, Customer, reason and request id, so a replayed refusal records once.
 */
export async function auditCustomerDenied(staff: Who, customerId: unknown, action: string, attempt: string, reason: string, requestId?: unknown, metadata: Record<string, unknown> = {}) {
  const t = target(customerId);
  await recordAudit(gatewayAuditTrail, {
    module: CUSTOMER_PROFILES_MODULE, action, outcome: "failure", actor: staffAuditActor(staff), target: t,
    description: `${staff.name} could not ${attempt} for ${t.display_name}: ${reason}`,
    metadata: { ...metadata, reason },
    occurred_at: new Date().toISOString(),
    operationId: `customer:${t.id}:${action}:denied:${staff.id}:${digest(`${reason}\n${typeof requestId === "string" ? requestId : ""}\n${JSON.stringify(metadata)}`)}`,
  });
}

/** The sensitive read of a Customer's notes. One event per person and Customer per minute, so a re-open is not a flood. */
export async function auditCustomerNotesRead(staff: Who, customerId: string) {
  const t = target(customerId);
  const minute = Math.floor(Date.now() / 60_000);
  await recordAudit(gatewayAuditTrail, {
    module: CUSTOMER_PROFILES_MODULE, action: "customer_note.viewed", outcome: "success", actor: staffAuditActor(staff), target: t,
    description: `${staff.name} read the Customer notes of ${t.display_name}.`,
    occurred_at: new Date().toISOString(),
    operationId: `customer:${t.id}:customer_note.viewed:${staff.id}:${minute}`,
  });
}
