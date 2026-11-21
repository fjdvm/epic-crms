import { database } from "@/lib/db";

/** A Customer's cancellation request on an Order before payment or preparing, as the Order page shows it. */
export interface CancelRequestState {
  requestId: string;
  status: "waiting" | "approved" | "declined" | "withdrawn";
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  declineReason: string | null;
  decidedBy: string | null;
}

/** The latest request on this Order, or null when there is none or CREOMS cannot read it (the Order then shows no request). */
export async function loadCancelRequest(orderId: number): Promise<CancelRequestState | null> {
  try {
    const [row] = await database()`select id, status, reason, requested_by_name, created_at, decline_reason, decided_by_name
      from public.order_cancel_requests where order_id = ${orderId} order by created_at desc limit 1`;
    if (!row) return null;
    return { requestId: String(row.id), status: row.status, reason: String(row.reason), requestedBy: String(row.requested_by_name),
      requestedAt: new Date(row.created_at), declineReason: row.decline_reason ?? null, decidedBy: row.decided_by_name ?? null };
  } catch {
    return null;
  }
}
