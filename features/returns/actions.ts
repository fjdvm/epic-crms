"use server";

import { approvals } from "@/features/approvals/server";
import type { ApprovalOptions, ApprovalResult } from "@/features/approvals/workflow";
import { canWork } from "@/lib/portal/roles";
import { revalidatePath } from "next/cache";
import { changeReturnStatus, type ReturnChangeResult, type ReturnStatusUpdate, type ReturnDecision } from "@/lib/storefront";
import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { gatewayAuditTrail, gatewayFileStorage } from "@/lib/gateway";
import { recordUpload } from "@/features/files/server";
import type { ReturnResolution } from "./returns";
import { database } from "@/lib/db";
import { RETURNS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { loadReturns, loadReturnDetail, loadReturnStats, type ReturnQuery } from "./returns";

/** Each endpoint proves Returns access itself, before opening a database connection. */
export async function getReturns(query: ReturnQuery = {}) {
  await requireModule(RETURNS_MODULE);
  return loadReturns(database, query);
}
export async function getReturnStats() {
  await requireModule(RETURNS_MODULE);
  return loadReturnStats(database);
}
export async function getReturnDetail(id: number) {
  await requireModule(RETURNS_MODULE);
  return loadReturnDetail(database, id);
}

/** Identity comes only from the Portal; CREOMS only reads the storefront-owned tables. */
async function decide(id: number, decision: ReturnDecision, form?: FormData, options: ApprovalOptions = {}): Promise<ReturnChangeResult | ApprovalResult> {
  const staff = await requireModule(RETURNS_MODULE);
  if (!canWork(staff)) return { ok: false, reason: "Your Role can only view shop work." };
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Return number." };
  if (decision.status === "approved" && typeof decision.goodsRequired !== "boolean") {
    return { ok: false, reason: "Say whether the goods must come back." };
  }
  if (decision.status === "declined" && (typeof decision.declineReason !== "string" || !decision.declineReason.trim())) {
    return { ok: false, reason: "Enter a reason for declining the Return." };
  }
  if (decision.status === "approved" && decision.finalResolution !== undefined &&
    decision.finalResolution !== "refund" && decision.finalResolution !== "replacement") {
    return { ok: false, reason: "Choose refund or replacement as the Resolution." };
  }
  let result: ReturnChangeResult;
  let orderId: number;
  try {
    const [current] = await database()<{ status: string; goods_required: boolean | null; order_id: number; preferred_resolution: ReturnResolution; final_resolution: ReturnResolution | null }[]>`
      select status, goods_required, order_id, preferred_resolution, final_resolution from public.order_returns where id = ${id}`;
    if (!current) return { ok: false, reason: "Return was not found." };
    orderId = current.order_id;
    const allowed = decision.status === "approved" || decision.status === "declined"
      ? current.status === "requested"
      : decision.status === "goods received"
        ? current.status === "approved" && current.goods_required === true
        : (current.status === "goods received" || (current.status === "approved" && current.goods_required === false)) &&
          current.final_resolution === (decision.status === "refunded" ? "refund" : "replacement");
    if (!allowed) return { ok: false, reason: "Return already changed or is not ready for this step; refresh it before trying again." };
    if (decision.status === "approved") decision = { ...decision, finalResolution: decision.finalResolution ?? current.preferred_resolution };
    const execute = async (): Promise<ReturnChangeResult> => {
    if (decision.status === "refunded") {
      if (!(form instanceof FormData) || form.getAll("proof").length !== 1) {
        return { ok: false, reason: "Choose exactly one refund proof screenshot." };
      }
      try {
        const upload = await recordUpload(RETURNS_MODULE, form.get("proof"), staff.username);
        if (!upload) return { ok: false, reason: "Choose exactly one refund proof screenshot." };
        const fileId = upload.fileId;
        await gatewayFileStorage.linkRefundProof(fileId, id);
        decision = { status: "refunded", refundProofFileId: fileId };
      } catch {
        return { ok: false, reason: "Refund proof could not be stored. The Return was not marked refunded." };
      }
    }
    // Rebuild the payload so browser-supplied identity, time and unrelated fields never travel.
    const actor = { staffId: staff.username, staffName: staff.name };
    const update: ReturnStatusUpdate = decision.status === "approved"
      ? { ...actor, status: "approved", goodsRequired: decision.goodsRequired, finalResolution: decision.finalResolution ?? current.preferred_resolution }
      : decision.status === "declined"
        ? { ...actor, status: "declined", declineReason: decision.declineReason.trim() }
        : decision.status === "refunded"
          ? { ...actor, status: "refunded", refundProofFileId: decision.refundProofFileId }
          : { ...actor, status: decision.status };
    result = await changeReturnStatus(id, update);
    if (result.ok) {
      const action = `return.${update.status.replaceAll(" ", "_")}`;
      await recordAudit(gatewayAuditTrail, {
        action, module: RETURNS_MODULE, outcome: "success", actor: staffAuditActor(staff),
        target: { type: "return", id: String(id), display_name: `RMA-${id}` },
        description: `${staff.name} marked Return RMA-${id} (Order #${orderId}) ${update.status}.`,
        occurred_at: new Date().toISOString(), operationId: `return:${id}:${action}`,
      });
    }
    if (result.ok && update.status === "refunded") {
      try {
        await gatewayFileStorage.promote(update.refundProofFileId);
      } catch {
        return { ok: false, reason: "The Return was marked refunded, but its refund proof could not be made Permanent. Refresh the Return; do not repeat the refund." };
      }
    }
    return result;
    };
    if (decision.status === "goods received") {
      result = await execute();
    } else {
      // Selling price alone determines the Approval limit; delivery fees are excluded.
      const [amount] = await database()`select coalesce(sum(quantity::bigint * price_in_centavos), 0)::text as selling
        from public.order_return_items where return_id = ${id}`;
      const action = decision.status === "approved" ? "return.approve" : decision.status === "declined" ? "return.decline"
        : decision.status === "refunded" ? "return.refund" : "return.replace";
      const approved = await approvals().run(staff, { module: RETURNS_MODULE, action, targetId: String(id),
        payload: decision.status === "refunded" ? { status: "refunded" } : { ...decision }, amountInCentavos: Number(amount.selling) }, options, execute);
      if (!approved.ok) return approved;
      result = approved;
    }
  } catch {
    return { ok: false, reason: "Return is temporarily unavailable." };
  }
  if (result.ok) {
    revalidatePath("/(app)/returns", "layout");
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/(app)/customer-profiles", "layout");
  }
  return result;
}

export async function approveReturn(id: number, goodsRequired = false, finalResolution?: ReturnResolution, options: ApprovalOptions = {}): Promise<ReturnChangeResult | ApprovalResult> {
  return decide(id, { status: "approved", goodsRequired, finalResolution }, undefined, options);
}

export async function declineReturn(id: number, reason: string, options: ApprovalOptions = {}): Promise<ReturnChangeResult | ApprovalResult> {
  return decide(id, { status: "declined", declineReason: reason }, undefined, options);
}

export async function markReturnGoodsReceived(id: number): Promise<ReturnChangeResult | ApprovalResult> {
  return decide(id, { status: "goods received" });
}

export async function markReturnRefunded(id: number, form?: FormData, options: ApprovalOptions = {}): Promise<ReturnChangeResult | ApprovalResult> {
  // Only a confirmed, signed upload reference may supply the proof File id.
  return decide(id, { status: "refunded", refundProofFileId: "" }, form, options);
}

export async function markReturnReplaced(id: number, options: ApprovalOptions = {}): Promise<ReturnChangeResult | ApprovalResult> {
  return decide(id, { status: "replaced" }, undefined, options);
}

/** Settle uncertain proof from the recorded Return without repeating the refund decision. */
export async function reconcileRefundProof(id: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const staff = await requireModule(RETURNS_MODULE);
  if (!canWork(staff)) return { ok: false, reason: "Your Role can only view shop work." };
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Return number." };
  try {
    const [record] = await database()<{ status: string; refund_proof_file_id: string | null }[]>`
      select status, refund_proof_file_id from public.order_returns where id = ${id}`;
    if (!record || record.status !== "refunded" || !record.refund_proof_file_id) {
      return { ok: false, reason: "The Return has no confirmed refund proof. Refresh the Return before trying again." };
    }
    await gatewayFileStorage.promote(record.refund_proof_file_id);
    return { ok: true };
  } catch {
    return { ok: false, reason: "The refund proof could not be made Permanent. Refresh the Return; do not repeat the refund." };
  }
}
