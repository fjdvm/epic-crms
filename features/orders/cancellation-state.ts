import { database } from "@/lib/db";
import { crmsDatabase } from "@/lib/crms-db";

/** Where a dispatched Order's cancellation request stands, as the Order page shows it. */
export interface CancellationState {
  requestId: string;
  status: "waiting-manager" | "waiting-ceo" | "approved" | "declined" | "cancelled";
  reason: string;
  declineReason: string | null;
  stockOutcome: "restock" | "write-off" | null;
  refundMethod: string | null;
  requestedBy: string;
}

/** The latest request on this Order, or null when there is none or CREOMS cannot read it (the page then offers a new one). */
export async function loadCancellationState(orderId: number): Promise<CancellationState | null> {
  try {
    const [row] = await database()`select id, status, reason, stock_outcome, refund_method, actor_name from public.order_cancellations
      where order_id = ${orderId} order by created_at desc limit 1`;
    if (!row) return null;
    const [step] = await crmsDatabase()`select status, decline_reason from crms.approval_requests where id = ${row.id}`;
    const status = row.status === "cancelled" ? "cancelled" : (step?.status ?? "waiting-manager");
    if (!["waiting-manager", "waiting-ceo", "approved", "declined", "cancelled"].includes(status)) return null;
    return {
      requestId: String(row.id), status, reason: String(row.reason), declineReason: step?.decline_reason ?? null,
      stockOutcome: row.stock_outcome ?? null, refundMethod: row.refund_method ?? null, requestedBy: String(row.actor_name ?? "Staff"),
    };
  } catch {
    return null;
  }
}
