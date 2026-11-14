"use server";

import { requireModule } from "@/lib/portal/staff";
import { RETURNS_MODULE } from "@/lib/portal/config";
import { approvals } from "./server";

export async function getApprovalRequests(module: string = RETURNS_MODULE) {
  const staff = await requireModule(module);
  return approvals().list(staff, module);
}
export async function decideApproval(module: string, id: string, decision: "approve" | "decline", reason = "") {
  const staff = await requireModule(module);
  return approvals().decide(staff, module, id, decision, reason);
}
export async function setApprovalLimit(amountInCentavos: number) {
  const staff = await requireModule("Portal Settings");
  return approvals().setLimit(staff, amountInCentavos);
}

/** Requests a stock decision only; IMS execution belongs to the stock handling ticket. */
export async function requestWriteOff(returnId: number, reason: string) {
  const staff = await requireModule(RETURNS_MODULE);
  if (!Number.isSafeInteger(returnId) || returnId < 1) return { ok: false as const, reason: "Invalid Return number.", approvalId: undefined };
  const { database } = await import("@/lib/db");
  const [amount] = await database()`select sum(quantity::bigint * price_in_centavos)::text as selling
    from public.order_return_items where return_id = ${returnId}`;
  if (amount.selling === null) return { ok: false as const, reason: "Return items were not found.", approvalId: undefined };
  const result = await approvals().run(staff, { module: RETURNS_MODULE, action: "write-off", targetId: String(returnId),
    payload: {}, amountInCentavos: Number(amount.selling) }, { reason }, async () => ({ ok: false as const, reason: "A write-off needs an inspection before stock can change." }));
  return { ...result, approvalId: "approvalId" in result ? result.approvalId : undefined };
}

/** Acceptance is explicitly human; this endpoint never applies or sends the suggestion. */
export async function acceptAISuggestion(module: string, suggestionId: string, targetId: string) {
  const staff = await requireModule(module);
  const { canWork } = await import("@/lib/portal/roles");
  if (!canWork(staff)) return { ok: false, reason: "Your Role can only view shop work." };
  if (typeof suggestionId !== "string" || !suggestionId.trim() || suggestionId.length > 200 || typeof targetId !== "string" || !targetId.trim()) {
    return { ok: false, reason: "Choose an AI suggestion and its target." };
  }
  return approvals().acceptAI(staff, module, suggestionId, targetId);
}
