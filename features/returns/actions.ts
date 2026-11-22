"use server";

import { approvals } from "@/features/approvals/server";
import type { ApprovalOptions, ApprovalResult } from "@/features/approvals/workflow";
import { canWork, READ_ONLY_REASON, shopRole } from "@/lib/portal/roles";
import { revalidatePath } from "next/cache";
import { changeReturnStatus, changeStorefrontRefundDestination, createStorefrontReplacementOrder, extendStorefrontRefundWindow, inspectStorefrontReturn, type ReturnInspectionResult, type ReturnChangeResult, type ReturnStatusUpdate, type ReturnDecision } from "@/lib/storefront";
import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { gatewayAuditTrail, gatewayFileStorage } from "@/lib/gateway";
import { recordUpload } from "@/features/files/server";
import type { ReturnResolution } from "./returns";
import { database } from "@/lib/db";
import { RETURNS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { checkDestination, describeMasked, destinationDigest, maskDestination, mayChangeDestination, readDestination, sameDestination, type DestinationInput, type MaskedRefundDestination, type RefundDestination } from "./refund-destination";
import { formatPesos } from "@/features/customer-profiles/format";
import { checkRefund } from "./refund-rules";
import { crmsDatabase } from "@/lib/crms-db";
import { loadRefundCorrections, loadRefundDraft } from "./refund-draft";
import { refundProofRow } from "./refund-proof-reader";
import { reviewRefundProof, type RefundDraft } from "./refund-review";
import { refundMethodLabel, TRANSFER_VERIFIED } from "./refund-record";
import type { ProofCorrection } from "@/features/orders/proof-read";
import { refundFacts } from "./refund-facts";
import { randomUUID } from "node:crypto";
import { loadReplacementStock, shortStockReason } from "./replacement-stock";
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
    // Staff never type a destination at refund time: the money goes where the Customer confirmed, and only a Manager changes that.
    if (decision.status === "refunded" && form instanceof FormData && [...form.keys()].some(key => /destination|account|bank|number|method/i.test(key))) {
      return { ok: false, reason: "The refund goes to the destination the Customer confirmed. It cannot be changed here; a Manager changes it first." };
    }
    let deliveryFeeReason: string | undefined;
    let refundItems = 0;
    let refundFee = 0;
    let draft: RefundDraft | null = null;
    let corrections: ProofCorrection[] = [];
    if (decision.status === "refunded") {
      const facts = await refundFacts(id, orderId);
      if (!facts) return { ok: false, reason: "Return was not found." };
      // The proof and details were saved first (#615), so the Proof reader's findings could be checked before this step.
      // Asking for approval needs none of it; carrying the refund out needs all of it (checked in `execute`).
      draft = await loadRefundDraft(crmsDatabase(), id);
      deliveryFeeReason = draft?.deliveryFeeReason ?? undefined;
      const checked = checkRefund({ ...facts, deliveryFeeReason });
      if (!checked.ok) return { ok: false, reason: checked.error };
      refundItems = facts.itemsInCentavos;
      refundFee = checked.deliveryFeeInCentavos;
    }
    if (decision.status === "approved") decision = { ...decision, finalResolution: decision.finalResolution ?? current.preferred_resolution };
    // A replacement is only offered when the IMS has every item. Stock that could not be read is left to the storefront,
    // which checks and reserves it when the Replacement Order is made.
    if ((decision.status === "approved" && decision.finalResolution === "replacement") || decision.status === "replaced") {
      const stock = await loadReplacementStock(database, id);
      if (stock.state === "short") return { ok: false, reason: shortStockReason(stock) };
    }
    const execute = async (): Promise<ReturnChangeResult> => {
    if (decision.status === "refunded") {
      if (!draft) return { ok: false, reason: "Save the refund proof and details first, then check the Proof reader's findings." };
      if (draft.expectedInCentavos !== refundItems + refundFee || draft.amountInCentavos !== draft.expectedInCentavos) {
        return { ok: false, reason: "The refund amount changed after the proof was saved. Save the refund proof again." };
      }
      if (!(form instanceof FormData) || form.get(TRANSFER_VERIFIED) !== "true") {
        return { ok: false, reason: "Verify the real transfer with the payment provider, then confirm that you did." };
      }
      const row = await refundProofRow(crmsDatabase(), draft.fileId);
      corrections = await loadRefundCorrections(crmsDatabase(), draft.fileId);
      const review = reviewRefundProof(row ? { status: row.status === "none" ? "pending" : row.status, findings: row.findings } : null, corrections, draft.savedAt);
      if (review.reading) return { ok: false, reason: "The Proof reader is still checking the refund proof. Wait for its findings." };
      if (review.unresolved.length > 0) return { ok: false, reason: `Correct or proceed past the flagged details first: ${review.unresolved.join(", ")}.` };
      // The proof is already stored and linked to this Return; the details are the ones Staff saved and the findings were checked against.
      decision = { status: "refunded", refundProofFileId: draft.fileId, ...(deliveryFeeReason ? { deliveryFeeReason } : {}),
        refundAmountInCentavos: draft.amountInCentavos, refundPaidMethod: draft.method, refundedOn: draft.refundedOn, refundReference: draft.reference };
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
          ? { ...actor, status: "refunded", refundProofFileId: decision.refundProofFileId, ...(decision.deliveryFeeReason ? { deliveryFeeReason: decision.deliveryFeeReason } : {}),
            refundAmountInCentavos: decision.refundAmountInCentavos, refundPaidMethod: decision.refundPaidMethod, refundedOn: decision.refundedOn, refundReference: decision.refundReference }
          : { ...actor, status: decision.status };
    result = await changeReturnStatus(id, update);
    if (result.ok) {
      // A refund is only recorded once it was approved and carried out with proof, so it is audited as `return.refund_approved`.
      const action = update.status === "refunded" ? "return.refund_approved" : `return.${update.status.replaceAll(" ", "_")}`;
      await recordAudit(gatewayAuditTrail, {
        action, module: RETURNS_MODULE, outcome: "success", actor: staffAuditActor(staff),
        target: { type: "return", id: String(id), display_name: `RMA-${id}` },
        description: update.status === "refunded"
          ? `${staff.name} marked Return RMA-${id} (Order #${orderId}) refunded: items ${formatPesos(refundItems)}, Delivery fee ${update.deliveryFeeReason ? `${formatPesos(refundFee)} (${update.deliveryFeeReason})` : "not included"}; ${formatPesos(update.refundAmountInCentavos)} sent by ${refundMethodLabel(update.refundPaidMethod)} on ${update.refundedOn}, reference ${update.refundReference}.`
          : `${staff.name} marked Return RMA-${id} (Order #${orderId}) ${update.status}.`,
        occurred_at: new Date().toISOString(), operationId: `return:${id}:${action}`,
        ...(update.status === "refunded" ? { metadata: { amountInCentavos: update.refundAmountInCentavos, method: update.refundPaidMethod, refundedOn: update.refundedOn, reference: update.refundReference, itemsInCentavos: refundItems, deliveryFeeIncluded: Boolean(update.deliveryFeeReason), deliveryFeeInCentavos: refundFee, transferVerified: true, ...(update.deliveryFeeReason ? { deliveryFeeReason: update.deliveryFeeReason } : {}),
          proofChanges: corrections.map(c => ({ kind: c.kind, field: c.field, reason: c.reason, by: c.by, originalValue: c.originalValue, originalFinding: c.originalFinding, ...(c.kind === "correction" ? { correctedValue: c.value } : {}) })) } } : {}),
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
      // The items alone determine the Approval limit; the Delivery fee never counts toward it.
      const [amount] = await database()`select coalesce(sum(quantity::bigint * price_in_centavos), 0)::text as selling
        from public.order_return_items where return_id = ${id}`;
      const action = decision.status === "approved" ? "return.approve" : decision.status === "declined" ? "return.decline"
        : decision.status === "refunded" ? "return.refund" : "return.replace";
      const approved = await approvals().run(staff, { module: RETURNS_MODULE, action, targetId: String(id),
        payload: decision.status === "refunded" ? { status: "refunded", ...(deliveryFeeReason ? { deliveryFee: true } : {}) } : { ...decision }, amountInCentavos: Number(amount.selling) }, options, execute);
      if (!approved.ok) return approved;
      result = approved;
    }
  } catch {
    return { ok: false, reason: "Return is temporarily unavailable." };
  }
  if (result.ok && (decision.status === "approved" || decision.status === "declined")) {
    // The Manager picked the outcome, so the Staff request asking them to decide this Return is done.
    const outcome = decision.status === "declined" ? "Rejected" : decision.finalResolution === "replacement" ? "Replacement" : "Refund";
    await approvals().closeRequests(staff, RETURNS_MODULE, "return.decide", String(id), `${outcome} for RMA-${id}`)
      .catch((error) => console.error(`The decide request for RMA-${id} could not be closed`, error));
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

export type ReturnOutcome = "reject" | "refund" | "replacement";

/**
 * A Manager picks one outcome for a Requested Return: reject it with a reason the Customer sees, refund it to the way the
 * Customer paid, or send a replacement (only when in stock). When the goods need not come back, a replacement is made at
 * once as a linked ₱0 Order; a refund then goes on to the refund steps. Staff cannot decide; they use `requestReturnDecision`.
 */
export async function decideReturn(id: number, choice: { outcome: ReturnOutcome; goodsRequired?: boolean; reason?: string }): Promise<ReturnChangeResult | ApprovalResult> {
  const staff = await requireModule(RETURNS_MODULE);
  const role = shopRole(staff.role);
  if (role === "staff") return { ok: false, reason: "A Manager decides Returns. Use Request approval · decide return." };
  if (role !== "manager") return { ok: false, reason: READ_ONLY_REASON };
  const outcome = choice?.outcome;
  if (outcome === "reject") return declineReturn(id, typeof choice.reason === "string" ? choice.reason : "");
  if (outcome !== "refund" && outcome !== "replacement") return { ok: false, reason: "Choose reject, refund or replacement." };
  if (typeof choice.goodsRequired !== "boolean") return { ok: false, reason: "Say whether the goods must come back." };
  const approved = await approveReturn(id, choice.goodsRequired, outcome);
  if (!approved.ok || outcome === "refund" || choice.goodsRequired) return approved;
  const replaced = await markReturnReplaced(id);
  return replaced.ok ? replaced : { ok: false, reason: `${replaced.reason} The Return is approved for a replacement; send it from the Return when it can be made.` };
}

/**
 * Staff check a Requested Return (made inside the window, and whether the photo supports the reason) and ask a Manager to
 * decide it. The window is worked out here from the storefront's times, never taken from the browser. Never optimistic.
 */
export async function requestReturnDecision(id: number, check: { photoSupportsReason: boolean; note: string }): Promise<{ ok: true; approvalId: string } | { ok: false; reason: string }> {
  const staff = await requireModule(RETURNS_MODULE);
  if (shopRole(staff.role) !== "staff") return { ok: false, reason: shopRole(staff.role) === "manager" ? "Managers decide the Return directly." : READ_ONLY_REASON };
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Return number." };
  if (typeof check?.photoSupportsReason !== "boolean") return { ok: false, reason: "Say whether the photo supports the reason." };
  const note = typeof check.note === "string" ? check.note.trim() : "";
  if (!note) return { ok: false, reason: "Enter a note for the Manager." };
  if (note.length > 1000) return { ok: false, reason: "Keep the note to 1,000 characters." };
  try {
    const [current] = await database()<{ status: string; in_window: boolean | null }[]>`
      select r.status, r.requested_at < o.delivered_at + (case when to_jsonb(o)->>'refund_window_extended_at' is null then 24 else 48 end) * interval '1 hour' as in_window
      from public.order_returns r join public.orders o on o.id = r.order_id where r.id = ${id}`;
    if (!current) return { ok: false, reason: "Return was not found." };
    if (current.status !== "requested") return { ok: false, reason: "Return already changed; refresh it before trying again." };
    const requests = await approvals().list(staff, RETURNS_MODULE);
    if (requests.some((r) => r.action === "return.decide" && r.target_id === String(id) && r.status === "waiting-manager")) {
      return { ok: false, reason: "A Manager was already asked to decide this Return." };
    }
    const [amount] = await database()`select coalesce(sum(quantity::bigint * price_in_centavos), 0)::text as selling
      from public.order_return_items where return_id = ${id}`;
    const result = await approvals().run(staff, { module: RETURNS_MODULE, action: "return.decide", targetId: String(id),
      payload: { inWindow: current.in_window === true, photoSupportsReason: check.photoSupportsReason }, amountInCentavos: Number(amount.selling) },
      { reason: note }, async () => ({ ok: false as const, reason: "A Manager decides Returns." }));
    if (result.ok || !("approvalId" in result) || !result.approvalId) return { ok: false, reason: result.reason };
    revalidatePath("/(app)/returns", "layout");
    revalidatePath("/approvals");
    return { ok: true, approvalId: result.approvalId };
  } catch {
    return { ok: false, reason: "Return is temporarily unavailable." };
  }
}

export async function markReturnGoodsReceived(id: number): Promise<ReturnChangeResult | ApprovalResult> {
  return decide(id, { status: "goods received" });
}

export async function markReturnRefunded(id: number, form?: FormData, options: ApprovalOptions = {}): Promise<ReturnChangeResult | ApprovalResult> {
  // Only a confirmed, signed upload reference may supply the proof File id.
  return decide(id, { status: "refunded", refundProofFileId: "", refundAmountInCentavos: 0, refundPaidMethod: "", refundedOn: "", refundReference: "" }, form, options);
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

const DESTINATION_ROW = `to_jsonb(r)->>'refund_method' as refund_method, to_jsonb(r)->>'refund_account_name' as refund_account_name,
  to_jsonb(r)->>'refund_account_number' as refund_account_number, to_jsonb(r)->>'refund_bank_name' as refund_bank_name`;
type DestinationRow = { status: string; order_id: number; goods_required: boolean | null; final_resolution: ReturnResolution | null;
  refund_method: string | null; refund_account_name: string | null; refund_account_number: string | null; refund_bank_name: string | null };
async function destinationRow(id: number): Promise<DestinationRow | undefined> {
  const sql = database();
  const [row] = await sql<DestinationRow[]>`select r.status, r.order_id, r.goods_required, r.final_resolution, ${sql.unsafe(DESTINATION_ROW)} from public.order_returns r where r.id = ${id}`;

  return row;
}

/**
 * The full account number, only where refund processing needs it: an approved refund whose goods are back (or not required) and
 * that is not yet Refunded. Staff and Managers only (Admin and CEO view it masked). Every look is audited, with the number masked.
 */
export async function revealRefundDestination(id: number): Promise<{ ok: true; destination: RefundDestination } | { ok: false; reason: string }> {
  const staff = await requireModule(RETURNS_MODULE);
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Return number." };
  try {
    const row = await destinationRow(id);
    if (!row) return { ok: false, reason: "Return was not found." };
    const ready = row.final_resolution === "refund" && (row.status === "goods received" || (row.status === "approved" && row.goods_required === false));
    if (!ready) return { ok: false, reason: "The full number is shown only when the refund is ready to be sent." };
    const destination = readDestination(row);
    if (!destination) return { ok: false, reason: "This Return has no confirmed refund destination." };
    await recordAudit(gatewayAuditTrail, {
      action: "return.refund_destination_viewed", module: RETURNS_MODULE, outcome: "success", actor: staffAuditActor(staff),
      target: { type: "return", id: String(id), display_name: `RMA-${id}` },
      description: `${staff.name} opened the full Refund destination on Return RMA-${id} (Order #${row.order_id}): ${describeMasked(maskDestination(destination))}.`,
      occurred_at: new Date().toISOString(), operationId: `return:${id}:refund_destination_viewed:${randomUUID()}`,
    });

    return { ok: true, destination };
  } catch { return { ok: false, reason: "The refund destination is temporarily unavailable. Try again." }; }
}

/**
 * A Manager changes a locked Refund destination, with a reason and the Customer's confirmation, before money is sent. Staff see
 * "Request approval". Never optimistic: it decides where money goes. The approval request holds only the masked form and a digest,
 * never the full number, and the Audit Event records the number masked.
 */
export async function changeRefundDestination(
  id: number,
  input: DestinationInput & { reason: string; customerConfirmed: boolean },
  options: ApprovalOptions = {},
): Promise<{ ok: true; destination: MaskedRefundDestination } | { ok: false; reason: string } | ApprovalResult> {
  const staff = await requireModule(RETURNS_MODULE);
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Return number." };
  const checked = checkDestination(input);
  if (!checked.ok) return checked;
  const why = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!why) return { ok: false, reason: "Enter a reason for changing the destination." };
  if (input.customerConfirmed !== true) return { ok: false, reason: "The Customer must confirm the new destination before it can change." };
  const next = checked.destination;
  try {
    const row = await destinationRow(id);
    if (!row) return { ok: false, reason: "Return was not found." };
    if (!mayChangeDestination(row.status, row.final_resolution)) return { ok: false, reason: "The destination can change only on an approved refund that has not been sent yet." };
    const current = readDestination(row);
    if (current && sameDestination(current, next)) return { ok: false, reason: "That is already the confirmed destination." };
    const from = current ? describeMasked(maskDestination(current)) : "none";
    const to = describeMasked(maskDestination(next));
    const result = await approvals().run(staff, { module: RETURNS_MODULE, action: "return.change-destination", targetId: String(id),
      payload: { to, digest: destinationDigest(next) }, amountInCentavos: 0 }, { ...options, reason: options.reason ?? why }, async () => {
      const done = await changeStorefrontRefundDestination(id, { ...next, reason: why, customerConfirmed: true }, { id: staff.username, name: staff.name });
      if (done.ok) {
        await recordAudit(gatewayAuditTrail, {
          action: "return.refund_destination_changed", module: RETURNS_MODULE, outcome: "success", actor: staffAuditActor(staff),
          target: { type: "return", id: String(id), display_name: `RMA-${id}` },
          description: `${staff.name} changed the Refund destination on Return RMA-${id} (Order #${row.order_id}) from ${from} to ${to}, with the Customer's confirmation: ${why}`,
          occurred_at: new Date().toISOString(), operationId: `return:${id}:refund_destination_changed:${done.changedAt.getTime()}`,
          metadata: { from, to, reason: why, customerConfirmed: true },
        });
      }
      return done.ok ? { ok: true as const, destination: maskDestination(next) } : done;
    });
    if (result.ok) {
      revalidatePath("/(app)/returns", "layout");
      revalidatePath("/approvals");
    }
    return result;
  } catch { return { ok: false, reason: "The refund destination is temporarily unavailable. Refresh the Return before retrying." }; }
}
