"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { crmsDatabase } from "@/lib/crms-db";
import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { gatewayAuditTrail } from "@/lib/gateway";
import { PAYMENTS_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REASON } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";

import { FIELDS, type Field, type Findings } from "./proof-reader";

export type ProofChangeResult = { ok: true } | { ok: false; reason: string };

const MAX_VALUE = 200;
const MAX_REASON = 500;

/**
 * Staff or a Manager correct what the Proof reader read, or proceed despite a flagged detail, with a reason.
 * Both only ADD a record: the original reading is never changed, and nothing here marks an Order paid or touches
 * its status. A reused reference or a third rejected proof is still stopped by Mark paid itself, which reads the
 * real proof each time, so a correction can never bypass a Manager. Admin view and cannot change.
 */
async function record(proofId: number, field: string, kind: "correction" | "override", value: string, reason: string): Promise<ProofChangeResult> {
  const staff = await requireModule(PAYMENTS_MODULE);
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (!Number.isSafeInteger(proofId) || proofId < 1) return { ok: false, reason: "Unknown payment proof." };
  if (!(FIELDS as readonly string[]).includes(field)) return { ok: false, reason: "Unknown detail." };
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!why) return { ok: false, reason: kind === "correction" ? "Enter a reason for the correction." : "Enter a reason to proceed." };
  if (why.length > MAX_REASON) return { ok: false, reason: `Keep the reason under ${MAX_REASON} characters.` };
  const typed = typeof value === "string" ? value.trim() : "";
  if (kind === "correction" && !typed) return { ok: false, reason: "Enter the corrected value." };
  if (typed.length > MAX_VALUE) return { ok: false, reason: "That value is too long." };
  const f = field as Field;

  try {
    const crms = crmsDatabase();
    const [row] = await crms<{ order_id: number; status: string; findings: Findings | null }[]>`select order_id, status, findings from crms.payment_proof_reads where proof_id = ${proofId}`;
    // Nothing to correct until the reader has stored what it read; the original is what a correction is measured against.
    if (!row?.findings || row.status === "reading") return { ok: false, reason: "The Proof reader has not read this proof yet." };
    const original = row.findings[f];
    if (kind === "override" && original.finding === "Match") return { ok: false, reason: "That detail has no flag to proceed past." };

    const [made] = await crms<{ id: string }[]>`insert into crms.payment_proof_corrections (proof_id, order_id, kind, field, original_value, corrected_value, original_finding, reason, by_id, by_name)
      values (${proofId}, ${row.order_id}, ${kind}, ${f}, ${original.read}, ${kind === "correction" ? typed : null}, ${original.finding}, ${why}, ${staff.username}, ${staff.name}) returning id`;
    // A change with no audit entry must not stay: take it back so a retry never leaves a duplicate.
    try { await recordAudit(gatewayAuditTrail, {
      module: PAYMENTS_MODULE, action: kind === "correction" ? "payment_proof.corrected" : "payment_proof.flag_overridden", outcome: "success",
      actor: staffAuditActor(staff), target: { type: "order", id: String(row.order_id), display_name: `Order #${row.order_id}` },
      description: kind === "correction"
        ? `${staff.name} corrected the ${f} read from payment proof ${proofId} of Order #${row.order_id}: ${why}`
        : `${staff.name} proceeded despite the ${original.finding} ${f} on payment proof ${proofId} of Order #${row.order_id}: ${why}`,
      occurred_at: new Date().toISOString(), operationId: `proof-change:${proofId}:${randomUUID()}`,
      metadata: { proofId, field: f, reason: why, originalValue: original.read, originalFinding: original.finding, ...(kind === "correction" ? { correctedValue: typed } : {}) },
    }); } catch (error) { await crms`delete from crms.payment_proof_corrections where id = ${made.id}`; throw error; }
    revalidatePath(`/orders/${row.order_id}`);
    revalidatePath("/payments");
    return { ok: true };
  } catch {
    return { ok: false, reason: "That could not be saved. Try again in a moment." };
  }
}

export async function correctProofReading(proofId: number, field: string, value: string, reason: string): Promise<ProofChangeResult> {
  return record(proofId, field, "correction", value, reason);
}

export async function proceedDespiteFlag(proofId: number, field: string, reason: string): Promise<ProofChangeResult> {
  return record(proofId, field, "override", "", reason);
}
