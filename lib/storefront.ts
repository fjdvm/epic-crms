import type { ReturnResolution } from "@/features/returns/returns";
import { createHmac } from "node:crypto";

export interface CourierBooking {
  name: "Lalamove" | "Grab";
  trackingUrl: string;
  riderName?: string;
  riderPlate?: string;
  riderPhone?: string;
}

export type OrderStatusUpdate =
  | { status: "confirmed" | "cancelled" | "preparing"; deliveryFeeInCentavos?: number; courier?: never }
  | { status: "dispatched"; courier?: CourierBooking; deliveryFeeInCentavos?: never }
  | { status: "delivered"; deliveryPhotoFileId: string; deliveryFeeInCentavos?: never; courier?: never }
  | { status: "paid"; staffId: string; staffName: string; deliveryFeeInCentavos?: never; courier?: never };
export type OrderChangeResult =
  | { ok: true; order: { id: number; status: string; deliveryFeeInCentavos: number | null } }
  | { ok: false; reason: string };

/** Mint the storefront's scoped, five-minute HS256 credential for this request. Never sent to a browser. */
function credential(secret: string, resource: "orders" | "returns" | "stock" = "orders"): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "creoms", aud: `brenraphaels-${resource}`, scope: resource === "stock" ? "stock:read" : `${resource}:status`, iat, exp: iat + 300,
  })}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

/** The storefront owns all Order writes and Customer emails. Never retry an uncertain write automatically. */
export async function changeOrderStatus(id: number, update: OrderStatusUpdate, responseStatus: string = update.status): Promise<OrderChangeResult> {
  return orderRequest(id, update, "status", responseStatus);
}

export async function cancelStorefrontItems(id: number, lineIds: number[], staff: { id: string; name: string }, expectedStatus: string): Promise<OrderChangeResult> {
  return orderRequest(id, { lineIds, staffId: staff.id, staffName: staff.name, expectedStatus }, "items/cancel");
}

async function orderRequest(id: number, update: OrderStatusUpdate | { lineIds: number[]; staffId: string; staffName: string; expectedStatus: string }, path = "status", responseStatus?: string): Promise<OrderChangeResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  try {
    const response = await fetch(new URL(`/api/internal/orders/${id}/${path}`, origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret)}` },
      body: JSON.stringify(update), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body.error === "string" ? body.error : "Storefront refused the change." };
    if (("status" in update && update.status === "delivered" && body.deliveryPhotoFileId !== update.deliveryPhotoFileId) ||
      body.id !== id || ("status" in update ? body.status !== (responseStatus ?? update.status) : !["placed", "confirmed", "awaiting payment", "paid", "preparing"].includes(body.status)) ||
      ("courier" in update && update.courier !== undefined && (body.courier?.name !== update.courier.name || body.courier?.trackingUrl !== update.courier.trackingUrl)) ||
      ("deliveryFeeInCentavos" in update && update.deliveryFeeInCentavos !== undefined && body.deliveryFeeInCentavos !== update.deliveryFeeInCentavos) ||
      !(body.deliveryFeeInCentavos === null || Number.isSafeInteger(body.deliveryFeeInCentavos))) {
      return { ok: false, reason: "Storefront did not confirm the change. Refresh the Order before trying again." };
    }
    return { ok: true, order: { id: body.id, status: body.status, deliveryFeeInCentavos: body.deliveryFeeInCentavos } };
  } catch {
    return { ok: false, reason: "Storefront could not confirm the change. Refresh the Order before trying again." };
  }
}

export type ReturnDecision =
  | { status: "approved"; goodsRequired: boolean; finalResolution?: ReturnResolution }
  | { status: "declined"; declineReason: string }
  | { status: "goods received" | "replaced" }
  | { status: "refunded"; refundProofFileId: string };
export type ReturnStatusUpdate = ReturnDecision & { staffId: string; staffName: string };
export type ReturnChangeResult =
  | { ok: true; return: { id: number; status: ReturnStatusUpdate["status"] } }
  | { ok: false; reason: string };

/** The storefront commits the decision, history and Customer notifications together. */
export async function changeReturnStatus(id: number, update: ReturnStatusUpdate): Promise<ReturnChangeResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  const uncertain = "Storefront could not confirm the change. Refresh the Return before trying again.";
  try {
    const response = await fetch(new URL(`/api/internal/returns/${id}/status`, origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret, "returns")}` },
      body: JSON.stringify(update), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body?.error === "string" ? body.error : "Storefront refused the change." };
    if (body?.id !== id || body.status !== update.status ||
      (update.status === "approved" && (body.goodsRequired !== update.goodsRequired || body.finalResolution !== update.finalResolution)) ||
      (update.status === "refunded" && body.refundProofFileId !== update.refundProofFileId) ||
      (update.status === "declined" && body.declineReason !== update.declineReason) ||
      body.actedBy?.id !== update.staffId || body.actedBy?.name !== update.staffName ||
      typeof body.actedBy?.at !== "string" || !Number.isFinite(Date.parse(body.actedBy.at))) {
      return { ok: false, reason: uncertain };
    }
    return { ok: true, return: { id, status: update.status } };
  } catch {
    return { ok: false, reason: uncertain };
  }
}

/** What the IMS holds for one Size, or nulls when the IMS could not answer for it. */
export interface ImsSizeStock { sizeId: number; quantity: number | null; reserved: number | null; available: number | null }

/**
 * Reads IMS stock through the storefront, which holds the IMS credential and the Size mapping.
 * Called when Staff open a page, never on a timer. Null means the storefront could not be reached.
 */
export async function readStock(sizeIds: number[]): Promise<Map<number, ImsSizeStock> | null> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32 || sizeIds.length === 0) return null;
  try {
    const sizes = new Map<number, ImsSizeStock>();
    // The storefront answers at most 200 Sizes per request.
    for (let start = 0; start < sizeIds.length; start += 200) {
      const url = new URL("/api/internal/stock", origin);
      url.searchParams.set("sizeIds", sizeIds.slice(start, start + 200).join(","));
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${credential(secret, "stock")}` },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const body = await response.json();
      if (!Array.isArray(body.sizes)) return null;
      for (const size of body.sizes as ImsSizeStock[]) sizes.set(size.sizeId, size);
    }
    return sizes;
  } catch {
    return null;
  }
}
