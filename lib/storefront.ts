import { createHmac } from "node:crypto";

export type OrderStatusUpdate =
  | { status: "confirmed" | "cancelled" | "preparing" | "dispatched"; deliveryFeeInCentavos?: number }
  | { status: "delivered"; deliveryPhotoFileId: string; deliveryFeeInCentavos?: never }
  | { status: "paid"; staffId: string; staffName: string; deliveryFeeInCentavos?: never };
export type OrderChangeResult =
  | { ok: true; order: { id: number; status: string; deliveryFeeInCentavos: number | null } }
  | { ok: false; reason: string };

/** Mint the storefront's scoped, five-minute HS256 credential for this request. Never sent to a browser. */
function credential(secret: string, resource: "orders" | "returns" = "orders"): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "creoms", aud: `brenraphaels-${resource}`, scope: `${resource}:status`, iat, exp: iat + 300,
  })}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

/** The storefront owns all Order writes and Customer emails. Never retry an uncertain write automatically. */
export async function changeOrderStatus(id: number, update: OrderStatusUpdate): Promise<OrderChangeResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  try {
    const response = await fetch(new URL(`/api/internal/orders/${id}/status`, origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret)}` },
      body: JSON.stringify(update), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body.error === "string" ? body.error : "Storefront refused the change." };
    if ((update.status === "delivered" && body.deliveryPhotoFileId !== update.deliveryPhotoFileId) ||
      body.id !== id || body.status !== update.status ||
      (update.deliveryFeeInCentavos !== undefined && body.deliveryFeeInCentavos !== update.deliveryFeeInCentavos) ||
      !(body.deliveryFeeInCentavos === null || Number.isSafeInteger(body.deliveryFeeInCentavos))) {
      return { ok: false, reason: "Storefront did not confirm the change. Refresh the Order before trying again." };
    }
    return { ok: true, order: { id: body.id, status: body.status, deliveryFeeInCentavos: body.deliveryFeeInCentavos } };
  } catch {
    return { ok: false, reason: "Storefront could not confirm the change. Refresh the Order before trying again." };
  }
}

export type ReturnDecision =
  | { status: "approved"; goodsRequired: boolean }
  | { status: "declined"; declineReason: string }
  | { status: "goods received" | "refunded" };
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
      (update.status === "approved" && body.goodsRequired !== update.goodsRequired) ||
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
