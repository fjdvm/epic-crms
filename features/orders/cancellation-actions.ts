"use server";

import { revalidatePath } from "next/cache";
import { database } from "@/lib/db";
import { crmsDatabase } from "@/lib/crms-db";
import { requireModule } from "@/lib/portal/staff";
import { FULFILMENT_MODULE } from "@/lib/portal/config";
import { canWork, shopRole, READ_ONLY_REASON } from "@/lib/portal/roles";
import { approvals } from "@/features/approvals/server";
import type { ApprovalOptions, ApprovalResult } from "@/features/approvals/workflow";
import { auditFulfilment, auditFulfilmentDenied } from "./fulfilment-audit";
import { syncCancellationRequests } from "./cancellation-sync";
import { changeDispatchedCancellation, type CancellationResult } from "@/lib/storefront";
import { recordUpload } from "@/features/files/server";
import { gatewayFileStorage } from "@/lib/gateway";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function requestDispatchedCancellation(id: number, reason: string): Promise<CancellationResult | ApprovalResult> {
  const staff = await requireModule(FULFILMENT_MODULE);
  const refused = async <T extends { ok: false; reason: string }>(refusal: T): Promise<T> => {
    if (Number.isSafeInteger(id) && id >= 1) await auditFulfilmentDenied(id, staff, "order.cancellation_requested", "request cancellation of", refusal.reason);
    return refusal;
  };
  if (!canWork(staff)) return refused({ ok: false, reason: READ_ONLY_REASON });
  if (!Number.isSafeInteger(id) || id < 1 || typeof reason !== "string" || !reason.trim() || reason.length > 1000 || /[<>\p{Cc}]/u.test(reason)) return refused({ ok: false, reason: "Enter a valid Order number and a plain-text reason." });
  try {
    const result = await changeDispatchedCancellation(id, { action: "request", reason: reason.trim() }, staff);
    if (!result.ok) return refused(result);
    // A request starts a Manager approval, so its event is a pending audit record (#743). The request id makes a replay one event.
    await auditFulfilment(id, staff, "order.cancellation_requested", `${staff.name} asked to cancel dispatched Order #${id}.`, { request_id: result.requestId, status: result.status }, result.requestId, true);
    await syncCancellationRequests();
    revalidatePath("/approvals"); revalidatePath(`/orders/${id}`);
    return { ok: false, reason: result.status === "approved" ? "Cancellation approved; settlement pending" : result.status === "declined" ? "Cancellation request declined" : "Waiting for approval", status: result.status, approvalId: result.requestId };
  } catch { return refused({ ok: false, reason: "Cancellation request is saved if the storefront confirmed it. Refresh before trying again." }); }
}

export async function loadDispatchedCancellations() {
  await requireModule(FULFILMENT_MODULE);
  try {
    await syncCancellationRequests();
    const rows = await database()`select * from public.order_cancellations order by created_at desc`;
    const steps = await crmsDatabase()`select id, status from crms.approval_requests where action = 'order.cancel-after-dispatch'`;
    return { ok: true as const, requests: rows.map(r => ({ requestId: String(r.id), orderId: Number(r.order_id), reason: String(r.reason),
      status: r.status === 'cancelled' ? 'cancelled' : steps.find(s => s.id === r.id)?.status ?? 'waiting-manager',
      stockOutcome: r.stock_outcome, refundMethod: r.refund_method, refundProofFileId: r.refund_proof_file_id })) };
  } catch { return { ok: false as const, reason: "Cancellation requests are temporarily unavailable." }; }
}

/** A Manager settles only a separately approved cancellation. Manager authority applies to the money/stock step. */
export async function settleDispatchedCancellation(id: number, requestId: string, stockOutcome: "restock" | "write-off", form?: FormData, options: ApprovalOptions = {}): Promise<CancellationResult | ApprovalResult> {
  const staff = await requireModule(FULFILMENT_MODULE);
  const refused = async <T extends { ok: false; reason: string }>(refusal: T): Promise<T> => {
    // A request waiting for a Manager is the approval workflow's own event, not a refusal.
    if (Number.isSafeInteger(id) && id >= 1 && !(refusal as ApprovalResult).approvalId) {
      await auditFulfilmentDenied(id, staff, "order.cancelled_after_dispatch", "settle the cancellation of", refusal.reason, uuid.test(requestId) ? { request_id: requestId } : {});
    }
    return refusal;
  };
  if (shopRole(staff.role) !== "manager") return refused({ ok: false, reason: "Only a CREOMS Manager can settle a dispatched cancellation." });
  if (!Number.isSafeInteger(id) || id < 1 || !uuid.test(requestId) || !["restock", "write-off"].includes(stockOutcome)) return refused({ ok: false, reason: "Choose a valid cancellation request and stock outcome." });
  try {
    const [approved] = await crmsDatabase()`select id from crms.approval_requests where id = ${requestId} and module = 'Fulfilment'
      and action = 'order.cancel-after-dispatch' and target_id = ${String(id)} and status = 'approved'`;
    if (!approved) return refused({ ok: false, reason: "A Manager must approve this cancellation first." });
    const [order] = await database()`select status, payment_method from public.orders where id = ${id}`;
    if (!order || order.status !== "dispatched") return refused({ ok: false, reason: "Only a dispatched Order can be cancelled here. Refresh the Order." });
    const prepaid = ["gcash", "maya", "bank-transfer"].includes(order.payment_method);
    if (!prepaid && order.payment_method !== "cash-on-delivery") return refused({ ok: false, reason: "This payment method needs reconciliation first." });
    if (!prepaid && form && form.getAll("proof").length) return refused({ ok: false, reason: "Cash on Delivery has no refund." });
    const [amount] = await database()`select coalesce(sum(quantity::bigint * price_in_centavos),0)::text as selling from public.order_lines where order_id = ${id}`;
    const result = await approvals().run(staff, { module: FULFILMENT_MODULE, action: "order.cancel-settle", targetId: String(id),
      payload: { requestId, stockOutcome, refundMethod: prepaid ? order.payment_method : null, moneyDecision: prepaid || stockOutcome === "write-off" },
      amountInCentavos: Number(amount.selling) }, { ...options, reason: options.reason ?? "Settle approved dispatched cancellation" }, async (): Promise<CancellationResult> => {
      let proofId: string | null = null;
      try {
        const [intent] = await database()`select status, stock_outcome, refund_method, refund_proof_file_id from public.order_cancellations where id = ${requestId} and order_id = ${id}`;
        if (intent?.status === "settling") {
          if (intent.stock_outcome !== stockOutcome || intent.refund_method !== (prepaid ? order.payment_method : null)) return { ok: false, reason: "Resume the recorded stock outcome and refund method." };
          proofId = intent.refund_proof_file_id;
          if (prepaid && !proofId) return { ok: false, reason: "The recorded refund proof needs reconciliation." };
        } else if (prepaid) {
          if (!(form instanceof FormData) || form.getAll("proof").length !== 1) return { ok: false, reason: "Choose exactly one refund proof screenshot." };
          const upload = await recordUpload(FULFILMENT_MODULE, form.get("proof"), staff.username);
          if (!upload) return { ok: false, reason: "Choose a confirmed refund proof uploaded by you." };
          proofId = upload.fileId;
          await gatewayFileStorage.linkOrderRefundProof(proofId, id);
        }
        // Keep approved, linked evidence before potentially interrupted IMS work.
        // Recovery uses persisted proof, never an expiring browser reference.
        if (proofId) await gatewayFileStorage.promote(proofId);
      } catch { return { ok: false, reason: "Refund proof could not be prepared. No cancellation was sent; retry with the same approval." }; }
      const changed = await changeDispatchedCancellation(id, { action: "settle", requestId, stockOutcome,
        refundMethod: prepaid ? order.payment_method : null, refundProofFileId: proofId }, staff);
      if (!changed.ok) return changed;
      await crmsDatabase()`update crms.approval_requests set status = 'completed', completed_at = now() where id = ${requestId} and status = 'approved'`;
      // Money and stock: the event is a pending audit record, and the request id makes a replay one event.
      await auditFulfilment(id, staff, "order.cancelled_after_dispatch", `${staff.name} settled the cancellation of dispatched Order #${id}.`,
        { request_id: requestId, stock_outcome: stockOutcome, refund_method: prepaid ? order.payment_method : null }, requestId, true);
      return changed;
    });
    if (result.ok) { revalidatePath(`/orders/${id}`); revalidatePath("/orders"); revalidatePath("/fulfilment"); revalidatePath("/approvals"); return result; }
    return refused(result);
  } catch { return refused({ ok: false, reason: "Cancellation could not be confirmed. Refresh the Order; do not repeat a refund." }); }
}

export async function reconcileCancellationProof(id: number) {
  const staff = await requireModule(FULFILMENT_MODULE);
  if (shopRole(staff.role) !== "manager") return { ok: false, reason: READ_ONLY_REASON };
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Order number." };
  try {
    const [record] = await database()`select refund_proof_file_id from public.order_cancellations where order_id = ${id} and status = 'cancelled'`;
    if (!record?.refund_proof_file_id) return { ok: false, reason: "No confirmed cancellation refund proof." };
    await gatewayFileStorage.promote(record.refund_proof_file_id);
    return { ok: true };
  } catch { return { ok: false, reason: "Refund proof could not be made Permanent. Refresh; do not repeat the refund." }; }
}
