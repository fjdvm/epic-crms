"use server";

import { revalidatePath } from "next/cache";
import { changeReturnStatus, type ReturnChangeResult, type ReturnStatusUpdate, type ReturnDecision } from "@/lib/storefront";
import { gatewayFileStorage } from "@/lib/gateway";
import { checkImage, IMAGE_REFUSALS, MAX_IMAGE_BYTES } from "@/features/tickets/attachments";
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
async function decide(id: number, decision: ReturnDecision, form?: FormData): Promise<ReturnChangeResult> {
  const staff = await requireModule(RETURNS_MODULE);
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
    if (decision.status === "refunded") {
      if (!(form instanceof FormData) || form.getAll("proof").length !== 1 || !(form.get("proof") instanceof File)) {
        return { ok: false, reason: "Choose exactly one refund proof screenshot." };
      }
      const file = form.get("proof") as File;
      if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: IMAGE_REFUSALS["image-too-large"] };
      const image = { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
      const checked = checkImage(image);
      if (!checked.ok) return { ok: false, reason: IMAGE_REFUSALS[checked.reason] };
      try {
        const fileId = await gatewayFileStorage.upload({ ...image, contentType: checked.contentType });
        if (!fileId) throw new Error("Missing File id");
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

export async function approveReturn(id: number, goodsRequired = false, finalResolution?: ReturnResolution): Promise<ReturnChangeResult> {
  return decide(id, { status: "approved", goodsRequired, finalResolution });
}

export async function declineReturn(id: number, reason: string): Promise<ReturnChangeResult> {
  return decide(id, { status: "declined", declineReason: reason });
}

export async function markReturnGoodsReceived(id: number): Promise<ReturnChangeResult> {
  return decide(id, { status: "goods received" });
}

export async function markReturnRefunded(id: number, form?: FormData): Promise<ReturnChangeResult> {
  // File ids from the browser are ignored; only this upload may supply one.
  return decide(id, { status: "refunded", refundProofFileId: "" }, form);
}

export async function markReturnReplaced(id: number): Promise<ReturnChangeResult> {
  return decide(id, { status: "replaced" });
}
