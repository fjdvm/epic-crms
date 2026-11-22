"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { FIELDS, type Field, type Findings } from "@/features/orders/proof-reader";
import { recordUpload } from "@/features/files/server";
import { formatPesos } from "@/features/customer-profiles/format";
import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { gatewayAuditTrail, gatewayFileStorage } from "@/lib/gateway";
import { RETURNS_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REASON, shopRole } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { loadRefundDraft } from "./refund-draft";
import { refundFacts } from "./refund-facts";
import { checkRefundRecord, refundMethodLabel } from "./refund-record";
import { startRefundProofRead } from "./refund-proof-start";
import { checkRefund } from "./refund-rules";

export type RefundProofResult = { ok: true } | { ok: false; reason: string };

const MAX_VALUE = 200;
const MAX_REASON = 500;

/**
 * Staff or a Manager save the refund proof and the details of the money they sent, BEFORE the Return is marked Refunded, so the
 * Proof reader's findings are ready to check first (#615). Nothing here changes the Return's status or tells the Customer: it only stores
 * the proof against the Return, and a replacement proof replaces it and gets its own check. Marking Refunded is a separate step.
 */
export async function saveRefundProof(id: number, form: FormData): Promise<RefundProofResult> {
  const staff = await requireModule(RETURNS_MODULE);
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Return number." };
  if (!(form instanceof FormData)) return { ok: false, reason: "Choose exactly one refund proof screenshot." };
  // Staff never type a destination: the money goes where the Customer confirmed, and only a Manager changes that.
  if ([...form.keys()].some((key) => /destination|account|bank|number|method/i.test(key))) {
    return { ok: false, reason: "The refund goes to the destination the Customer confirmed. It cannot be changed here; a Manager changes it first." };
  }
  try {
    const [current] = await database()<{ status: string; goods_required: boolean | null; order_id: number; final_resolution: string | null }[]>`
      select status, goods_required, order_id, final_resolution from public.order_returns where id = ${id}`;
    if (!current) return { ok: false, reason: "Return was not found." };
    const ready = (current.status === "goods received" || (current.status === "approved" && current.goods_required === false)) && current.final_resolution === "refund";
    if (!ready) return { ok: false, reason: "Return already changed or is not ready for this step; refresh it before trying again." };
    if (current.goods_required === true) {
      const [lines] = await database()`select count(*)::int as count, count(*) filter (where coalesce(to_jsonb(order_return_items)->>'condition', '') = '')::int as pending
        from public.order_return_items where return_id = ${id}`;
      if (lines.count > 0 && lines.pending > 0) return { ok: false, reason: "Inspect the returned items first." };
    }
    const facts = await refundFacts(id, current.order_id);
    if (!facts) return { ok: false, reason: "Return was not found." };
    let deliveryFeeReason: string | undefined;
    if (form.get("includeDeliveryFee") === "true") {
      if (shopRole(staff.role) !== "manager") return { ok: false, reason: "Only a Manager can include the Delivery fee in a refund." };
      const typed = form.get("deliveryFeeReason");
      deliveryFeeReason = typeof typed === "string" ? typed.trim() : "";
    }
    const checked = checkRefund({ ...facts, deliveryFeeReason });
    if (!checked.ok) return { ok: false, reason: checked.error };
    const expected = facts.itemsInCentavos + checked.deliveryFeeInCentavos;
    const details = checkRefundRecord(form, { expectedInCentavos: expected, destinationMethod: facts.destinationMethod, requestedAt: facts.requestedAt });
    if (!details.ok) return { ok: false, reason: details.reason };
    if (form.getAll("proof").length !== 1) return { ok: false, reason: "Choose exactly one refund proof screenshot." };

    let upload: Awaited<ReturnType<typeof recordUpload>>;
    try {
      upload = await recordUpload(RETURNS_MODULE, form.get("proof"), staff.username);
      if (upload) await gatewayFileStorage.linkRefundProof(upload.fileId, id);
    } catch {
      return { ok: false, reason: "Refund proof could not be stored. Nothing was saved." };
    }
    if (!upload) return { ok: false, reason: "Choose exactly one refund proof screenshot." };
    const { record } = details;
    const crms = crmsDatabase();
    const replaced = await loadRefundDraft(crms, id);
    await crms`insert into crms.refund_proof_drafts (return_id, proof_file_id, amount_in_centavos, expected_in_centavos, method, refunded_on, reference, delivery_fee_reason, saved_by_id, saved_by_name)
      values (${id}, ${upload.fileId}, ${record.amountInCentavos}, ${expected}, ${record.method}, ${record.refundedOn}, ${record.reference}, ${deliveryFeeReason ?? null}, ${staff.username}, ${staff.name})
      on conflict (return_id) do update set proof_file_id = excluded.proof_file_id, amount_in_centavos = excluded.amount_in_centavos, expected_in_centavos = excluded.expected_in_centavos,
        method = excluded.method, refunded_on = excluded.refunded_on, reference = excluded.reference, delivery_fee_reason = excluded.delivery_fee_reason,
        saved_by_id = excluded.saved_by_id, saved_by_name = excluded.saved_by_name, saved_at = now()`;
    await recordAudit(gatewayAuditTrail, {
      module: RETURNS_MODULE, action: "return.refund_proof_saved", outcome: "success", actor: staffAuditActor(staff),
      target: { type: "return", id: String(id), display_name: `RMA-${id}` },
      description: `${staff.name} saved the refund proof for Return RMA-${id} (Order #${current.order_id}): ${formatPesos(record.amountInCentavos)} sent by ${refundMethodLabel(record.method)} on ${record.refundedOn}, reference ${record.reference}${replaced ? ", replacing an earlier proof" : ""}.`,
      occurred_at: new Date().toISOString(), operationId: `return:${id}:refund_proof_saved:${upload.fileId}`,
      metadata: { amountInCentavos: record.amountInCentavos, method: record.method, refundedOn: record.refundedOn, reference: record.reference, itemsInCentavos: facts.itemsInCentavos,
        deliveryFeeInCentavos: checked.deliveryFeeInCentavos, ...(deliveryFeeReason ? { deliveryFeeReason } : {}), ...(replaced ? { replacedFileId: replaced.fileId } : {}) },
    });
    // The Proof reader reads it in the background; this response never waits for it, and a failure is picked up by the schedule.
    startRefundProofRead(id);
    revalidatePath(`/returns/${id}`);
    revalidatePath("/(app)/returns", "layout");
    return { ok: true };
  } catch {
    return { ok: false, reason: "The refund proof could not be saved. Refresh the Return before trying again." };
  }
}

/**
 * Staff or a Manager correct what the Proof reader read, or proceed despite a flagged detail, with a reason (#615). Both only ADD a record:
 * the original reading stays as it was, and nothing here marks the Return Refunded. Admin and the CEO view and cannot change.
 */
async function record(id: number, field: string, kind: "correction" | "override", value: string, reason: string): Promise<RefundProofResult> {
  const staff = await requireModule(RETURNS_MODULE);
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Return number." };
  if (!(FIELDS as readonly string[]).includes(field)) return { ok: false, reason: "Unknown detail." };
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!why) return { ok: false, reason: kind === "correction" ? "Enter a reason for the correction." : "Enter a reason to proceed." };
  if (why.length > MAX_REASON) return { ok: false, reason: `Keep the reason under ${MAX_REASON} characters.` };
  const typed = typeof value === "string" ? value.trim() : "";
  if (kind === "correction" && !typed) return { ok: false, reason: "Enter the corrected value." };
  if (typed.length > MAX_VALUE) return { ok: false, reason: "That value is too long." };
  const f = field as Field;
  try {
    const [current] = await database()<{ status: string }[]>`select status from public.order_returns where id = ${id}`;
    if (!current) return { ok: false, reason: "Return was not found." };
    if (current.status === "refunded") return { ok: false, reason: "This Return is already Refunded." };
    const crms = crmsDatabase();
    const draft = await loadRefundDraft(crms, id);
    if (!draft) return { ok: false, reason: "Save the refund proof first." };
    const [row] = await crms<{ status: string; findings: Findings | null }[]>`select status, findings from crms.refund_proof_reads where proof_file_id = ${draft.fileId}`;
    // Nothing to correct until the reader has stored what it read; the original is what a correction is measured against.
    if (!row?.findings || row.status !== "read") return { ok: false, reason: "The Proof reader has not read this proof yet." };
    const original = row.findings[f];
    if (kind === "override" && original.finding === "Match") return { ok: false, reason: "That detail has no flag to proceed past." };
    const [made] = await crms<{ id: string }[]>`insert into crms.refund_proof_corrections (return_id, proof_file_id, kind, field, original_value, corrected_value, original_finding, reason, by_id, by_name)
      values (${id}, ${draft.fileId}, ${kind}, ${f}, ${original.read}, ${kind === "correction" ? typed : null}, ${original.finding}, ${why}, ${staff.username}, ${staff.name}) returning id`;
    // A change with no audit entry must not stay: take it back so a retry never leaves a duplicate.
    try {
      await recordAudit(gatewayAuditTrail, {
        module: RETURNS_MODULE, action: kind === "correction" ? "refund_proof.corrected" : "refund_proof.flag_overridden", outcome: "success",
        actor: staffAuditActor(staff), target: { type: "return", id: String(id), display_name: `RMA-${id}` },
        description: kind === "correction"
          ? `${staff.name} corrected the ${f} read from the refund proof of Return RMA-${id}: ${why}`
          : `${staff.name} proceeded despite the ${original.finding} ${f} on the refund proof of Return RMA-${id}: ${why}`,
        occurred_at: new Date().toISOString(), operationId: `refund-proof-change:${id}:${randomUUID()}`,
        metadata: { returnId: id, field: f, reason: why, originalValue: original.read, originalFinding: original.finding, ...(kind === "correction" ? { correctedValue: typed } : {}) },
      });
    } catch (error) { await crms`delete from crms.refund_proof_corrections where id = ${made.id}`; throw error; }
    revalidatePath(`/returns/${id}`);
    return { ok: true };
  } catch {
    return { ok: false, reason: "That could not be saved. Try again in a moment." };
  }
}

export async function correctRefundReading(id: number, field: string, value: string, reason: string): Promise<RefundProofResult> {
  return record(id, field, "correction", value, reason);
}

export async function proceedDespiteRefundFlag(id: number, field: string, reason: string): Promise<RefundProofResult> {
  return record(id, field, "override", "", reason);
}
