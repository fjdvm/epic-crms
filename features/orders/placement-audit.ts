import type { AuditEvent, AuditTrail } from "@/lib/audit-trail";
import { ORDERS_MODULE } from "@/lib/portal/config";

export interface PlacedOrderRow { id: number; created_at: Date }
/** The storefront saves this row in the same transaction as an automatic expiry, and for nothing else (key `order.expired:<id>`). */
export interface ExpiryRow { order_id: number; created_at: Date }
export interface EmailOutcomeRow { order_id: number; kind: string; occurrence?: string | null; status: "sent" | "failed" | (string & {}); reason: string | null; updated_at: Date }

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

const EXPIRY_ACTOR: AuditEvent["actor"] = { type: "process", id: "unpaid-order-expiry", display_name: "Unpaid Order expiry" };

/** An Online-payment Order cancelled because its payment window passed. A Staff or Manager cancellation never produces one. */
export function expiredEvent(row: ExpiryRow): AuditEvent {
  return {
    module: ORDERS_MODULE, action: "order.expired", outcome: "success", actor: EXPIRY_ACTOR, target: target(row.order_id),
    description: `Order #${row.order_id} was cancelled automatically because its payment window expired, and its Reservation was released.`,
    occurred_at: row.created_at.toISOString(), operationId: `order:${row.order_id}:order.expired`,
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
    metadata: { kind: row.kind, ...(row.occurrence ? { occurrence: row.occurrence } : {}), ...(reason ? { reason } : {}) },
    occurred_at: row.updated_at.toISOString(), operationId: `order:${row.order_id}:email:${row.kind}${row.occurrence ? `:${row.occurrence}` : ""}:${row.status}`,
  };
}

/** What the storefront saved, and which of it the Audit Logs already have. */
export interface OrderAuditPorts {
  orders(): Promise<PlacedOrderRow[]>;
  outcomes(): Promise<EmailOutcomeRow[]>;
  expiries(): Promise<ExpiryRow[]>;
  /** Which of these operation ids were already delivered. */
  delivered(operationIds: string[]): Promise<Set<string>>;
  markDelivered(operationId: string): Promise<void>;
  /** Acknowledged delivery: it throws when the gateway refuses, so the event is tried again at the next signal. */
  deliver: AuditTrail;
}

/**
 * Runs when the storefront signals CREOMS (and on a Staff-requested sync), never on a timer. The ledger of
 * delivered operation ids, and the gateway's own idempotency key, make a repeat add nothing.
 */
export async function syncOrderAudit(ports: OrderAuditPorts): Promise<{ delivered: number; failed: number }> {
  const events = [
    ...(await ports.orders()).map(placedEvent),
    ...(await ports.expiries()).map(expiredEvent),
    ...(await ports.outcomes()).map(emailEvent).filter((event): event is AuditEvent => event !== null),
  ];
  const done = await ports.delivered(events.map((event) => event.operationId));
  let delivered = 0, failed = 0;
  for (const event of events.filter((e) => !done.has(e.operationId))) {
    try {
      await ports.deliver(event);
      await ports.markDelivered(event.operationId);
      delivered += 1;
    } catch (error) {
      console.error("CREOMS Audit Event could not be recorded", error);
      failed += 1;
    }
  }
  return { delivered, failed };
}
