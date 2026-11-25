"use server";

import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { gatewayAuditTrail } from "@/lib/gateway";
import { ORDERS_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REASON } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { currentAutomaticChecks } from "@/features/settings/automatic-checks-server";
import { changeCodAmount } from "./cod-settings";
import { codFlags, COD_CHOICE_LABELS, COD_RULE_LABELS, COD_RULE_REASONS, type CodRule } from "./cod-flags";

export type CodFlagView = { rule: CodRule; label: string; reason: string };
export type CodFlagsResult = { ok: true; flags: Record<number, CodFlagView[]> } | { ok: false; reason: string };
const UNAVAILABLE = "Cash on Delivery flags are temporarily unavailable.";

async function load(ids: number[]): Promise<Map<number, CodRule[]> | null> {
  try { return await codFlags(database(), ids, (await currentAutomaticChecks()).cod); }
  catch (error) { console.error("COD flags could not be worked out", error); return null; }
}
const view = (flags: Map<number, CodRule[]>): Record<number, CodFlagView[]> =>
  Object.fromEntries([...flags].map(([id, rules]) => [id, rules.map(rule => ({ rule, label: COD_RULE_LABELS[rule], reason: COD_RULE_REASONS[rule] }))]));

/** Staff open one Order: its flags are listed, and each rule that fired is logged once. Customers never reach this. */
export async function loadCodFlags(orderId: number): Promise<CodFlagsResult> {
  await requireModule(ORDERS_MODULE);
  if (!Number.isSafeInteger(orderId) || orderId < 1) return { ok: false, reason: "Invalid Order number." };
  const flags = await load([orderId]);
  if (!flags) return { ok: false, reason: UNAVAILABLE };
  for (const rule of flags.get(orderId) ?? []) {
    await recordAudit(gatewayAuditTrail, {
      module: ORDERS_MODULE, action: "cod_flag.raised", outcome: "success", actor: { type: "process", id: "creoms", display_name: "CREOMS" },
      target: { type: "order", id: String(orderId), display_name: `Order #${orderId}` },
      description: `Order #${orderId} was flagged for Staff to double-check: ${COD_RULE_LABELS[rule]}.`,
      occurred_at: new Date().toISOString(), metadata: { rule }, operationId: `cod:${orderId}:${rule}`,
    });
  }
  return { ok: true, flags: view(flags) };
}

/** The same flags for a page of Orders, without logging. */
export async function loadCodFlagsForOrders(orderIds: number[]): Promise<CodFlagsResult> {
  await requireModule(ORDERS_MODULE);
  if (!Array.isArray(orderIds) || orderIds.length > 200 || !orderIds.every(id => Number.isSafeInteger(id) && id > 0)) return { ok: false, reason: "Invalid Order numbers." };
  const flags = await load(orderIds);
  return flags ? { ok: true, flags: view(flags) } : { ok: false, reason: UNAVAILABLE };
}

/** Admin only: the amount, in centavos, above which a first Cash on Delivery order is flagged. */
export async function setCodAmount(amountInCentavos: number) {
  const staff = await requireModule("Portal Settings");
  return changeCodAmount(staff, amountInCentavos);
}

/** Staff chose to ask for GCash first instead of confirming: nothing on the Order changes, the choice is logged. */
export async function recordAskGcashFirst(orderId: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const staff = await requireModule(ORDERS_MODULE);
  if (!Number.isSafeInteger(orderId) || orderId < 1) return { ok: false, reason: "Invalid Order number." };
  const target = { type: "order", id: String(orderId), display_name: `Order #${orderId}` };
  if (!canWork(staff)) {
    // A refused attempt keeps one identity per person and Order, so a replay records once.
    await recordAudit(gatewayAuditTrail, {
      module: ORDERS_MODULE, action: "cod_flag.ask_gcash", outcome: "failure", actor: staffAuditActor(staff), target,
      description: `${staff.name} could not choose to ask for GCash first on flagged Order #${orderId}: ${READ_ONLY_REASON}`,
      occurred_at: new Date().toISOString(), metadata: { choice: "ask-gcash", reason: READ_ONLY_REASON }, operationId: `cod-ask-gcash:${orderId}:denied:${staff.id}`,
    });
    return { ok: false, reason: READ_ONLY_REASON };
  }
  await recordAudit(gatewayAuditTrail, {
    module: ORDERS_MODULE, action: "cod_flag.ask_gcash", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "order", id: String(orderId), display_name: `Order #${orderId}` },
    description: `${staff.name} chose to ask for GCash first on flagged Order #${orderId} (${COD_CHOICE_LABELS["ask-gcash"]}).`,
    occurred_at: new Date().toISOString(), metadata: { choice: "ask-gcash" }, operationId: `cod-ask-gcash:${orderId}:${crypto.randomUUID()}`,
  });
  return { ok: true };
}
