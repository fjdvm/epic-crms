"use server";

import { approvals } from "@/features/approvals/server";
import type { ApprovalOptions, ApprovalResult } from "@/features/approvals/workflow";
import { canWork, READ_ONLY_REASON } from "@/lib/portal/roles";
import { revalidatePath } from "next/cache";
import { changeReturnStatus, createStorefrontReplacementOrder, extendStorefrontRefundWindow, inspectStorefrontReturn, type ReturnInspectionResult, type ReturnChangeResult, type ReturnStatusUpdate, type ReturnDecision } from "@/lib/storefront";
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
    if ((decision.status === "refunded" || decision.status === "replaced") && current.goods_required === true) {
      const [pending] = await database()`select count(*)::int as count from public.order_return_items where return_id = ${id}
        and coalesce(to_jsonb(order_return_items)->>'condition', '') = ''`;
      const [lines] = await database()`select count(*)::int as count from public.order_return_items where return_id = ${id}`;
      if (lines.count > 0 && pending.count > 0) return { ok: false, reason: "Inspect the returned items first." };
    }
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
        const [paid] = await database()<{ payment_method: string }[]>`select payment_method from public.orders where id = ${orderId}`;
        // The refund goes back the way the Customer paid; the storefront checks this against the Order.
        decision = { status: "refunded", refundProofFileId: fileId, refundMethod: paid?.payment_method };
      } catch {
        return { ok: false, reason: "Refund proof could not be stored. The Return was not marked refunded." };
      }
    }
    if (decision.status === "replaced") {
      // Approving the replacement sends it as a linked ₱0 Order with its own Reservation. The Return id keeps this safe to repeat.
      const created = await createStorefrontReplacementOrder(id, { id: staff.username, name: staff.name });
      if (!created.ok) return created;
      await recordAudit(gatewayAuditTrail, {
        action: "return.replacement_order_created", module: RETURNS_MODULE, outcome: "success", actor: staffAuditActor(staff),
        target: { type: "return", id: String(id), display_name: `RMA-${id}` },
        description: `${staff.name} approved the replacement for Return RMA-${id} (Order #${orderId}): Replacement Order #${created.replacementOrderId} was created.`,
        occurred_at: new Date().toISOString(), operationId: `return:${id}:replacement_order_created`,
        metadata: { orderId, replacementOrderId: created.replacementOrderId },
      });
    }
    // Rebuild the payload so browser-supplied identity, time and unrelated fields never travel.
    const actor = { staffId: staff.username, staffName: staff.name };
    const update: ReturnStatusUpdate = decision.status === "approved"
      ? { ...actor, status: "approved", goodsRequired: decision.goodsRequired, finalResolution: decision.finalResolution ?? current.preferred_resolution }
      : decision.status === "declined"
        ? { ...actor, status: "declined", declineReason: decision.declineReason.trim() }
        : decision.status === "refunded"
          ? { ...actor, status: "refunded", refundProofFileId: decision.refundProofFileId, refundMethod: decision.refundMethod }
          : { ...actor, status: decision.status };
    result = await changeReturnStatus(id, update);
    if (result.ok) {
      // A refund is only recorded once it was approved and carried out with proof, so it is audited as `return.refund_approved`.
      const action = update.status === "refunded" ? "return.refund_approved" : `return.${update.status.replaceAll(" ", "_")}`;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

/**
 * Staff inspect a Return's goods item by item: each whole line item is sellable (the storefront adds it back to IMS stock)
 * or damaged (needs a write-off request). Easy to undo, so Staff may do it; nothing here moves money.
 */
export async function inspectReturn(id: number, inspectionId: string, items: { orderLineId: number; condition: "sellable" | "damaged" }[]): Promise<ReturnInspectionResult> {
  const staff = await requireModule(RETURNS_MODULE);
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (!Number.isSafeInteger(id) || id < 1 || typeof inspectionId !== "string" || !UUID.test(inspectionId) || !Array.isArray(items)) return { ok: false, reason: "Invalid inspection." };
  try {
    const [current] = await database()`select status, order_id from public.order_returns where id = ${id}`;
    if (!current) return { ok: false, reason: "Return was not found." };
    const lines = await database()`select order_line_id, inspection_id, to_jsonb(order_return_items)->>'condition' as condition from public.order_return_items where return_id = ${id}`;
    const resumed = lines.length > 0 && lines.every(line => line.inspection_id === inspectionId);
    if (!resumed && (current.status !== "goods received" || lines.some(line => line.condition))) return { ok: false, reason: "Return is not ready to inspect or was already inspected." };
    const ids = new Set(items.map(item => item.orderLineId));
    if (!lines.length || ids.size !== items.length || ids.size !== lines.length || !lines.every(line => ids.has(Number(line.order_line_id))) ||
      !items.every(item => item.condition === "sellable" || item.condition === "damaged")) return { ok: false, reason: "Mark every item sellable or damaged." };
    const result = await inspectStorefrontReturn(id, { action: "inspect", inspectionId, items: items.map(({ orderLineId, condition }) => ({ orderLineId, condition })) }, staff);
    if (!result.ok) return result;
    const damaged = items.filter(item => item.condition === "damaged").length;
    await recordAudit(gatewayAuditTrail, {
      action: "return.inspected", module: RETURNS_MODULE, outcome: "success", actor: staffAuditActor(staff),
      target: { type: "return", id: String(id), display_name: `RMA-${id}` },
      description: `${staff.name} inspected Return RMA-${id} (Order #${current.order_id}): ${items.length - damaged} sellable, ${damaged} damaged.`,
      occurred_at: new Date().toISOString(), operationId: `return:${id}:inspected:${inspectionId}`,
    });
    revalidatePath("/(app)/returns", "layout");
    revalidatePath(`/orders/${current.order_id}`);
    return result;
  } catch { return { ok: false, reason: "Inspection is temporarily unavailable. Refresh the Return before retrying." }; }
}

/**
 * Write off a Return's damaged items. A Manager approves; above the Approval limit the CEO also does.
 * The limit is measured by the selling price of all the Return's items, per Return, not just the damaged ones.
 */
export async function writeOffReturn(id: number, options: ApprovalOptions = {}): Promise<ReturnInspectionResult | ApprovalResult> {
  const staff = await requireModule(RETURNS_MODULE);
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Return number." };
  try {
    const [current] = await database()`select order_id from public.order_returns where id = ${id}`;
    if (!current) return { ok: false, reason: "Return was not found." };
    const items = await database()`select inspection_id, to_jsonb(order_return_items)->>'condition' as condition,
      to_jsonb(order_return_items)->>'written_off_at' as written_off_at from public.order_return_items where return_id = ${id}`;
    const damaged = items.filter(item => item.condition === "damaged");
    if (!damaged.length || items.some(item => !item.inspection_id)) return { ok: false, reason: "This Return has no inspected damaged items to write off." };
    if (damaged.every(item => item.written_off_at)) return { ok: false, reason: "These items were already written off." };
    const inspectionId = String(items[0].inspection_id);
    const [amount] = await database()`select coalesce(sum(quantity::bigint * price_in_centavos), 0)::text as selling from public.order_return_items where return_id = ${id}`;
    const result = await approvals().run(staff, { module: RETURNS_MODULE, action: "write-off", targetId: String(id),
      payload: { inspectionId, source: "return" }, amountInCentavos: Number(amount.selling) }, options, async () => {
      const done = await inspectStorefrontReturn(id, { action: "write-off", inspectionId }, staff);
      if (done.ok) {
        await recordAudit(gatewayAuditTrail, {
          action: "writeoff.approved", module: RETURNS_MODULE, outcome: "success", actor: staffAuditActor(staff),
          target: { type: "return", id: String(id), display_name: `RMA-${id}` },
          description: `Write-off of damaged items on Return RMA-${id} (Order #${current.order_id}) was approved and recorded by ${staff.name}.`,
          occurred_at: new Date().toISOString(), operationId: `return:${id}:writeoff.approved:${inspectionId}`,
        });
      }
      return done;
    });
    if (result.ok) {
      revalidatePath("/(app)/returns", "layout");
      revalidatePath(`/orders/${current.order_id}`);
      revalidatePath("/approvals");
    }
    return result;
  } catch { return { ok: false, reason: "Write-off is temporarily unavailable. Refresh the Return before retrying." }; }
}

/**
 * A Manager extends an Order's Refund window once, by 24 hours, with a reason. Staff ask for it and see "Request approval".
 * It moves no money, so the amount is zero; the storefront refuses a second extension and a window that no longer applies.
 */
export async function extendRefundWindow(orderId: number, reason: string, options: ApprovalOptions = {}): Promise<{ ok: true; endsAt: Date } | { ok: false; reason: string } | ApprovalResult> {
  const staff = await requireModule(RETURNS_MODULE);
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (!Number.isSafeInteger(orderId) || orderId < 1) return { ok: false, reason: "Invalid Order number." };
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!why) return { ok: false, reason: "Enter a reason for extending the window." };
  try {
    const [order] = await database()<{ status: string; delivered_at: Date | null; extended_at: string | null }[]>`
      select status, delivered_at, to_jsonb(o)->>'refund_window_extended_at' as extended_at from public.orders o where id = ${orderId}`;
    if (!order) return { ok: false, reason: "Order was not found." };
    if (order.extended_at) return { ok: false, reason: "The Refund window was already extended once." };
    if (order.status !== "delivered" || !order.delivered_at) return { ok: false, reason: "Only a delivered Order has a Refund window to extend." };
    const result = await approvals().run(staff, { module: RETURNS_MODULE, action: "return.extend-window", targetId: String(orderId),
      payload: { reason: why }, amountInCentavos: 0 }, { ...options, reason: options.reason ?? why }, async () => {
      const done = await extendStorefrontRefundWindow(orderId, why, { id: staff.username, name: staff.name });
      if (done.ok) {
        await recordAudit(gatewayAuditTrail, {
          action: "return.window_extended", module: RETURNS_MODULE, outcome: "success", actor: staffAuditActor(staff),
          target: { type: "order", id: String(orderId), display_name: `Order #${orderId}` },
          description: `${staff.name} extended the Refund window on Order #${orderId} by 24 hours: ${why}`,
          occurred_at: new Date().toISOString(), operationId: `order:${orderId}:window_extended`, metadata: { reason: why },
        });
      }
      return done;
    });
    if (result.ok) {
      revalidatePath("/(app)/returns", "layout");
      revalidatePath(`/orders/${orderId}`);
      revalidatePath("/approvals");
    }
    return result;
  } catch { return { ok: false, reason: "The Refund window is temporarily unavailable. Refresh the Return before retrying." }; }
}
