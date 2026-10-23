"use server";

import { revalidatePath } from "next/cache";
import { changeReturnStatus, type ReturnChangeResult, type ReturnStatusUpdate, type ReturnDecision } from "@/lib/storefront";
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
async function decide(id: number, decision: ReturnDecision): Promise<ReturnChangeResult> {
  const staff = await requireModule(RETURNS_MODULE);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Return number." };
  if (decision.status === "approved" && typeof decision.goodsRequired !== "boolean") {
    return { ok: false, reason: "Say whether the goods must come back." };
  }
  if (decision.status === "declined" && (typeof decision.declineReason !== "string" || !decision.declineReason.trim())) {
    return { ok: false, reason: "Enter a reason for declining the Return." };
  }
  let result: ReturnChangeResult;
  let orderId: number;
  try {
    const [current] = await database()<{ status: string; goods_required: boolean | null; order_id: number }[]>`
      select status, goods_required, order_id from public.order_returns where id = ${id}`;
    if (!current) return { ok: false, reason: "Return was not found." };
    orderId = current.order_id;
    const allowed = decision.status === "approved" || decision.status === "declined"
      ? current.status === "requested"
      : decision.status === "goods received"
        ? current.status === "approved" && current.goods_required === true
        : current.status === "goods received" || (current.status === "approved" && current.goods_required === false);
    if (!allowed) return { ok: false, reason: "Return already changed or is not ready for this step; refresh it before trying again." };
    // Rebuild the payload so browser-supplied identity, time and unrelated fields never travel.
    const actor = { staffId: staff.username, staffName: staff.name };
    const update: ReturnStatusUpdate = decision.status === "approved"
      ? { ...actor, status: "approved", goodsRequired: decision.goodsRequired }
      : decision.status === "declined"
        ? { ...actor, status: "declined", declineReason: decision.declineReason.trim() }
        : { ...actor, status: decision.status };
    result = await changeReturnStatus(id, update);
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

export async function approveReturn(id: number, goodsRequired: boolean): Promise<ReturnChangeResult> {
  return decide(id, { status: "approved", goodsRequired });
}

export async function declineReturn(id: number, reason: string): Promise<ReturnChangeResult> {
  return decide(id, { status: "declined", declineReason: reason });
}

export async function markReturnGoodsReceived(id: number): Promise<ReturnChangeResult> {
  return decide(id, { status: "goods received" });
}

export async function markReturnRefunded(id: number): Promise<ReturnChangeResult> {
  return decide(id, { status: "refunded" });
}
