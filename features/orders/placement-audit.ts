import type { AuditEvent, AuditTrail } from "@/lib/audit-trail";
import { recordAudit } from "@/lib/audit-trail";
import { ORDERS_MODULE } from "@/lib/portal/config";

export interface PlacedOrderRow { id: number; created_at: Date }
export interface EmailOutcomeRow { order_id: number; kind: string; status: "sent" | "failed" | (string & {}); reason: string | null; updated_at: Date }

const ACTOR: AuditEvent["actor"] = { type: "process", id: "creoms", display_name: "CREOMS" };
const REASON_MAX = 200;
const EMAIL_ADDRESS = /[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g;

/** A failure reason is kept for the trail, but never with a Customer's email address in it. */
export function safeReason(reason: string | null): string {
  const cleaned = (reason ?? "").replace(EMAIL_ADDRESS, "[email removed]").replace(/\s+/g, " ").trim();
  return (cleaned || "No reason given").slice(0, REASON_MAX);
}

const target = (id: number) => ({ type: "order", id: String(id), display_name: `Order #${id}` });

export function placedEvent(order: PlacedOrderRow): AuditEvent {
  return {
    module: ORDERS_MODULE, action: "order.placed", outcome: "success", actor: ACTOR, target: target(order.id),
    description: `Order #${order.id} was placed by the Customer.`,
    occurred_at: order.created_at.toISOString(), operationId: `order:${order.id}:order.placed`,
  };
}

/** One event per outcome change; only a sent or failed email is an outcome, so waiting and retrying write nothing. */
export function emailEvent(row: EmailOutcomeRow): AuditEvent | null {
  if (row.status !== "sent" && row.status !== "failed") return null;
  const failed = row.status === "failed";
  const reason = failed ? safeReason(row.reason) : undefined;
  return {
    module: ORDERS_MODULE, action: failed ? "order.email_failed" : "order.email_sent", outcome: failed ? "failure" : "success",
    actor: ACTOR, target: target(row.order_id),
    description: `The ${row.kind} email for Order #${row.order_id} ${failed ? `failed: ${reason}` : "was sent."}`,
    metadata: { kind: row.kind, ...(reason ? { reason } : {}) },
    occurred_at: row.updated_at.toISOString(), operationId: `order:${row.order_id}:email:${row.kind}:${row.status}`,
  };
}

/** Records what the storefront already saved. The stable operation ids make a repeated sweep add nothing. */
export async function recordPlacementAudit(
  audit: AuditTrail, orders: PlacedOrderRow[], outcomes: EmailOutcomeRow[],
): Promise<{ placed: number; emails: number }> {
  const emails = outcomes.map(emailEvent).filter((event): event is AuditEvent => event !== null);
  for (const event of [...orders.map(placedEvent), ...emails]) await recordAudit(audit, event);
  return { placed: orders.length, emails: emails.length };
}
