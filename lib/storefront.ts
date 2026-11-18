import type { ReturnResolution } from "@/features/returns/returns";
import { createHmac } from "node:crypto";

export interface CourierBooking {
  name: "Lalamove" | "Grab";
  /** An https share link; optional, and can be added or fixed later while the Order is dispatched. */
  trackingUrl?: string;
  riderName?: string;
  riderPlate?: string;
  riderPhone?: string;
}

/** What Staff say when they reject a proof; the storefront keeps it, emails the Customer once and asks for another proof. */
export interface ProofRejection { reason: string; staffId: string; staffName: string }

/** The final amounts Staff saw when confirming, in centavos; the storefront checks them against its own figures. */
export interface ConfirmedAmounts { subtotalInCentavos: number; discountInCentavos: number; deliveryFeeInCentavos: number; totalInCentavos: number; staffId: string; staffName: string }

/** Cash a Cash on Delivery Order's courier or the shop collected; the storefront saves it with the status in one transaction. */
export interface CodCollection { amountInCentavos: number; staffId: string; staffName: string }

export type OrderStatusUpdate =
  | { status: "preparing"; staffId: string; staffName: string; courier?: never }
  | { status: "confirmed"; amounts: ConfirmedAmounts; deliveryFeeInCentavos?: number; courier?: never }
  | { status: "cancelled"; deliveryFeeInCentavos?: never; courier?: never; amounts?: never }
  | { status: "dispatched"; courier?: CourierBooking; deliveryFeeInCentavos?: never }
  | { status: "ready for pickup"; staffId: string; staffName: string; courier?: never; deliveryFeeInCentavos?: never; codCollection?: never }
  | { status: "collected"; staffId: string; staffName: string; codCollection?: CodCollection; courier?: never; deliveryFeeInCentavos?: never }
  | { status: "delivered"; deliveryPhotoFileId: string; codCollection?: CodCollection; deliveryFeeInCentavos?: never; courier?: never }
  | { status: "paid"; staffId: string; staffName: string; approvedAnyway?: { reason: string }; deliveryFeeInCentavos?: never; courier?: never };
export type OrderChangeResult =
  | { ok: true; order: { id: number; status: string; deliveryFeeInCentavos: number | null } }
  | { ok: false; reason: string };

/** Mint the storefront's scoped, five-minute HS256 credential for this request. Never sent to a browser. */
function credential(secret: string, resource: "orders" | "returns" | "stock" | "senior-pwd" = "orders"): string {
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

export async function rejectStorefrontProof(id: number, rejection: ProofRejection): Promise<OrderChangeResult & { rejections?: number }> {
  return orderRequest(id, rejection, "payment-proof/reject");
}

export async function cancelStorefrontItems(id: number, lineIds: number[], staff: { id: string; name: string }, expectedStatus: string): Promise<OrderChangeResult> {
  return orderRequest(id, { lineIds, staffId: staff.id, staffName: staff.name, expectedStatus }, "items/cancel");
}

/**
 * The storefront resends under the email's stable id, so asking twice never sends two, and first reconciles the
 * delivery status when Notification already accepted it (then it answers "reconciled" and sends nothing).
 * CREOMS only says who asked and which occurrence.
 */
export async function resendOrderEmail(id: number, email: { kind: string; occurrence: string | null }, staff: { id: string; name: string }): Promise<{ ok: true; reconciled: boolean } | { ok: false; reason: string }> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  const uncertain = "Storefront could not confirm the resend. Refresh the Order before trying again.";
  try {
    const response = await fetch(new URL(`/api/internal/orders/${id}/email/resend`, origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret)}` },
      body: JSON.stringify({ kind: email.kind, occurrence: email.occurrence, staffId: staff.id, staffName: staff.name }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body?.error === "string" ? body.error : "Storefront refused the resend." };
    if (body?.id !== id || body.kind !== email.kind || (body.occurrence ?? null) !== email.occurrence) return { ok: false, reason: uncertain };
    if (body.status !== "sent" && body.status !== "reconciled") return { ok: false, reason: "The email could not be sent again. Try again later." };
    return { ok: true, reconciled: body.status === "reconciled" };
  } catch {
    return { ok: false, reason: uncertain };
  }
}

async function orderRequest(id: number, update: OrderStatusUpdate | ProofRejection | { lineIds: number[]; staffId: string; staffName: string; expectedStatus: string }, path = "status", responseStatus?: string): Promise<OrderChangeResult & { rejections?: number }> {
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
    if (("status" in update && update.status === "preparing" && (
      body.packedBy?.id !== update.staffId || body.packedBy?.name !== update.staffName ||
      typeof body.packedBy?.at !== "string" || !Number.isFinite(Date.parse(body.packedBy.at)))) ||
      ("status" in update && update.status === "delivered" && body.deliveryPhotoFileId !== update.deliveryPhotoFileId) ||
      body.id !== id || ("status" in update ? body.status !== (responseStatus ?? update.status) : !["placed", "confirmed", "awaiting payment", "paid", "preparing"].includes(body.status)) ||
      ("courier" in update && update.courier !== undefined && (body.courier?.name !== update.courier.name || (body.courier?.trackingUrl ?? undefined) !== update.courier.trackingUrl)) ||
      ("deliveryFeeInCentavos" in update && update.deliveryFeeInCentavos !== undefined && body.deliveryFeeInCentavos !== update.deliveryFeeInCentavos) ||
      ("amounts" in update && update.amounts !== undefined && body.totalInCentavos !== undefined && body.totalInCentavos !== update.amounts.totalInCentavos) ||
      !(body.deliveryFeeInCentavos === null || Number.isSafeInteger(body.deliveryFeeInCentavos))) {
      return { ok: false, reason: "Storefront did not confirm the change. Refresh the Order before trying again." };
    }
    if (path === "payment-proof/reject") {
      if (body.status !== "awaiting payment" || !Number.isSafeInteger(body.rejections) || body.rejections < 1) {
        return { ok: false, reason: "Storefront did not confirm the change. Refresh the Order before trying again." };
      }
      return { ok: true, order: { id: body.id, status: body.status, deliveryFeeInCentavos: body.deliveryFeeInCentavos }, rejections: body.rejections };
    }
    return { ok: true, order: { id: body.id, status: body.status, deliveryFeeInCentavos: body.deliveryFeeInCentavos } };
  } catch {
    return { ok: false, reason: "Storefront could not confirm the change. Refresh the Order before trying again." };
  }
}

/**
 * Staff add or fix the booking of an Order that is still dispatched. The storefront saves it in one transaction and does
 * not email the Customer again. Not optimistic on the storefront side: CREOMS shows the change at once and rolls it back if this refuses.
 */
export async function changeOrderCourier(id: number, change: { courier: CourierBooking; staffId: string; staffName: string }): Promise<OrderChangeResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  const uncertain = "Storefront could not confirm the change. Refresh the Order before trying again.";
  try {
    const response = await fetch(new URL(`/api/internal/orders/${id}/courier`, origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret)}` },
      body: JSON.stringify(change), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body?.error === "string" ? body.error : "Storefront refused the change." };
    if (body?.id !== id || body.status !== "dispatched" || body.courier?.name !== change.courier.name ||
      (body.courier?.trackingUrl ?? undefined) !== change.courier.trackingUrl) return { ok: false, reason: uncertain };
    return { ok: true, order: { id, status: "dispatched", deliveryFeeInCentavos: Number.isSafeInteger(body.deliveryFeeInCentavos) ? body.deliveryFeeInCentavos : null } };
  } catch {
    return { ok: false, reason: uncertain };
  }
}

export type ReturnDecision =
  | { status: "approved"; goodsRequired: boolean; finalResolution?: ReturnResolution }
  | { status: "declined"; declineReason: string }
  | { status: "goods received" | "replaced" }
  | { status: "refunded"; refundProofFileId: string; refundMethod?: string };
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

export type VerificationChange =
  | { action: "approve"; expiresOn: string; override?: boolean }
  | { action: "decline"; reason: string }
  | { action: "revoke"; reason: string };
export type VerificationResult =
  | { ok: true; verification: { id: number; status: string; expiresOn: string | null } }
  | { ok: false; reason: string };

/**
 * The storefront owns the verification: the keyed hash, the one-ID-one-account rule, the decision email
 * (sent once, never with the ID number) and the Order hold. CREOMS only sends who decided and why.
 */
export async function changeVerification(id: number, change: VerificationChange & { staffId: string; staffName: string }): Promise<VerificationResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  const uncertain = "Storefront could not confirm the change. Refresh the verification before trying again.";
  try {
    const response = await fetch(new URL(`/api/internal/senior-pwd/${id}/${change.action}`, origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret, "senior-pwd")}` },
      body: JSON.stringify(change), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body?.error === "string" ? body.error : "Storefront refused the change." };
    const status = { approve: "approved", decline: "declined", revoke: "revoked" }[change.action];
    if (body?.id !== id || body.status !== status ||
      (change.action === "approve" && body.expiresOn !== change.expiresOn)) return { ok: false, reason: uncertain };
    return { ok: true, verification: { id, status, expiresOn: body.expiresOn ?? null } };
  } catch {
    return { ok: false, reason: uncertain };
  }
}

export type FailedDeliveryUpdate =
  | { action: "record"; attemptId: string; reason: string; nextStep: "rebook" | "request-cancellation"; customerMessage: string }
  | { action: "rebook"; attemptId: string; courier: CourierBooking }
  | { action: "restock" | "write-off"; attemptId: string };
export type FailedDeliveryResult = { ok: true; attemptId: string } | { ok: false; reason: string };

/** Stable attempt references make explicit recovery safe. No automatic retry of outside effects. */
export async function changeFailedDelivery(id: number, update: FailedDeliveryUpdate, staff: { id: string; name: string }): Promise<FailedDeliveryResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  const uncertain = "Storefront could not confirm the failed delivery. Refresh the Order before retrying with the same attempt reference.";
  try {
    const response = await fetch(new URL(`/api/internal/orders/${id}/failed-delivery`, origin), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret)}` },
      body: JSON.stringify({ ...update, staffId: staff.id, staffName: staff.name }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body?.error === "string" ? body.error : uncertain };
    if (body?.id !== id || body.status !== "dispatched" || body.attemptId !== update.attemptId || body.action !== update.action) return { ok: false, reason: uncertain };
    return { ok: true, attemptId: body.attemptId };
  } catch { return { ok: false, reason: uncertain }; }
}

export type CancellationDecision = { requestId: string; stockOutcome: "restock" | "write-off"; refundMethod: string | null; refundProofFileId: string | null };
export type CancellationResult = { ok: true; requestId: string; status: string } | { ok: false; reason: string };

/** Stable request IDs make explicit recovery safe; never automatically retry a cancellation. */
export async function changeDispatchedCancellation(id: number, input: { action: "request"; reason: string } | { action: "decide"; requestId: string; decision: "approved" | "declined"; reason: string } | ({ action: "settle" } & CancellationDecision), staff: { id: string; name: string }): Promise<CancellationResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL, secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  const uncertain = "Storefront could not confirm the cancellation. Refresh the Order before trying again.";
  try {
    const response = await fetch(new URL(`/api/internal/orders/${id}/cancellation`, origin), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret)}` },
      body: JSON.stringify({ ...input, staffId: staff.id, staffName: staff.name }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body.error === "string" ? body.error : uncertain };
    if (body.id !== id || typeof body.requestId !== "string" || (input.action === "request" ? !["waiting-manager", "approved", "declined"].includes(body.status) : body.status !== (input.action === "decide" ? input.decision : "cancelled")) ||
      input.action === "settle" && (body.requestId !== input.requestId || body.stockOutcome !== input.stockOutcome || body.refundMethod !== input.refundMethod || body.refundProofFileId !== input.refundProofFileId)) return { ok: false, reason: uncertain };
    return { ok: true, requestId: body.requestId, status: body.status };
  } catch { return { ok: false, reason: uncertain }; }
}

export type ReturnInspectionUpdate =
  | { action: "inspect"; inspectionId: string; items: { orderLineId: number; condition: "sellable" | "damaged" }[] }
  | { action: "write-off"; inspectionId: string };
export type ReturnInspectionResult = { ok: true; inspectionId: string } | { ok: false; reason: string };

/**
 * The storefront records each whole line item as sellable or damaged and adds sellable stock back through the IMS;
 * it also carries out an approved write-off and emails the Customer once. A stable inspectionId makes explicit recovery safe.
 * CREOMS never repeats an uncertain request on its own.
 */
export async function inspectStorefrontReturn(id: number, update: ReturnInspectionUpdate, staff: { id: string; name: string }): Promise<ReturnInspectionResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  const uncertain = "Storefront could not confirm the inspection. Refresh the Return before retrying with the same inspection reference.";
  try {
    const response = await fetch(new URL(`/api/internal/returns/${id}/inspection`, origin), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret, "returns")}` },
      body: JSON.stringify({ ...update, staffId: staff.id, staffName: staff.name }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body?.error === "string" ? body.error : uncertain };
    if (body?.id !== id || body.inspectionId !== update.inspectionId || body.action !== update.action) return { ok: false, reason: uncertain };
    return { ok: true, inspectionId: body.inspectionId };
  } catch { return { ok: false, reason: uncertain }; }
}

export type ReplacementOrderResult = { ok: true; replacementOrderId: number } | { ok: false; reason: string };

/**
 * The storefront makes the linked ₱0 Replacement Order for an approved replacement, reserves its stock, quotes no Delivery fee
 * and emails the Customer once. The Return id is the idempotency key, so asking again returns the same Order.
 */
export async function createStorefrontReplacementOrder(returnId: number, staff: { id: string; name: string }): Promise<ReplacementOrderResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  const uncertain = "Storefront could not confirm the Replacement Order. Refresh the Return before trying again.";
  try {
    const response = await fetch(new URL(`/api/internal/returns/${returnId}/replacement-order`, origin), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret, "returns")}` },
      body: JSON.stringify({ staffId: staff.id, staffName: staff.name }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body?.error === "string" ? body.error : "Storefront refused the Replacement Order." };
    if (body?.returnId !== returnId || !Number.isSafeInteger(body.replacementOrderId)) return { ok: false, reason: uncertain };
    return { ok: true, replacementOrderId: body.replacementOrderId };
  } catch { return { ok: false, reason: uncertain }; }
}

export type RefundWindowResult = { ok: true; endsAt: Date } | { ok: false; reason: string };

/** The storefront extends an Order's Refund window once by 24 hours and keeps the reason. It refuses a second extension. */
export async function extendStorefrontRefundWindow(orderId: number, reason: string, staff: { id: string; name: string }): Promise<RefundWindowResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  const uncertain = "Storefront could not confirm the extension. Refresh the Return before trying again.";
  try {
    const response = await fetch(new URL(`/api/internal/orders/${orderId}/refund-window/extend`, origin), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret, "returns")}` },
      body: JSON.stringify({ reason, staffId: staff.id, staffName: staff.name }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body?.error === "string" ? body.error : "Storefront refused the extension." };
    if (body?.orderId !== orderId || typeof body.endsAt !== "string" || !Number.isFinite(Date.parse(body.endsAt))) return { ok: false, reason: uncertain };
    return { ok: true, endsAt: new Date(body.endsAt) };
  } catch { return { ok: false, reason: uncertain }; }
}
