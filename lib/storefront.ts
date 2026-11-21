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
  | { status: "confirmed"; amounts: ConfirmedAmounts; deliveryFeeInCentavos?: number; /** The Payment account Staff chose; the Pay your Order email shows only it. */ paymentAccountId?: string; courier?: never }
  | { status: "cancelled"; /** Why Staff rejected the Order; the Customer is shown it. */ reason?: string; deliveryFeeInCentavos?: never; courier?: never; amounts?: never }
  | { status: "dispatched"; courier?: CourierBooking; deliveryFeeInCentavos?: never }
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

/** The storefront reads a confirmation's amounts as flat fields (and its own name for the discount), not as a nested `amounts` object. */
function wireBody(update: object): object {
  if (!("status" in update) || update.status !== "confirmed" || !("amounts" in update) || !update.amounts) return update;
  const { amounts, ...rest } = update as { amounts: ConfirmedAmounts };
  return {
    ...rest,
    subtotalInCentavos: amounts.subtotalInCentavos,
    approvedDiscountInCentavos: amounts.discountInCentavos,
    deliveryFeeInCentavos: amounts.deliveryFeeInCentavos,
    totalInCentavos: amounts.totalInCentavos,
    staffId: amounts.staffId,
    staffName: amounts.staffName,
  };
}

async function orderRequest(id: number, update: OrderStatusUpdate | ProofRejection | { lineIds: number[]; staffId: string; staffName: string; expectedStatus: string }, path = "status", responseStatus?: string): Promise<OrderChangeResult & { rejections?: number }> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  try {
    const response = await fetch(new URL(`/api/internal/orders/${id}/${path}`, origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret)}` },
      body: JSON.stringify(wireBody(update)), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
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
  | { status: "refunded"; refundProofFileId: string; deliveryFeeReason?: string;
    /** What Staff recorded: the amount sent, how, on what date and under what reference (epic-crms#613). */
    refundAmountInCentavos: number; refundPaidMethod: string; refundedOn: string; refundReference: string };
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
      (update.status === "refunded" && (body.refundProofFileId !== update.refundProofFileId ||
        body.refundAmountInCentavos !== update.refundAmountInCentavos || body.refundPaidMethod !== update.refundPaidMethod ||
        body.refundedOn !== update.refundedOn || body.refundReference !== update.refundReference ||
        (update.deliveryFeeReason ? !(Number.isSafeInteger(body.refundDeliveryFeeInCentavos) && body.refundDeliveryFeeInCentavos >= 0) : false))) ||
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
 * Ids are storefront Size ids (Order lines); the Stock page uses readProductStock with IMS product ids.
 */
export const readStock = (sizeIds: number[]): Promise<Map<number, ImsSizeStock> | null> =>
  readStockBy({ param: "sizeIds", list: "sizes", id: "sizeId" }, sizeIds);

/** The same read by IMS product id, which needs no Size mapping. The result's `sizeId` is the IMS product id. */
export const readProductStock = (productIds: number[]): Promise<Map<number, ImsSizeStock> | null> =>
  readStockBy({ param: "productIds", list: "products", id: "productId" }, productIds);

const quantityOrNull = (value: unknown): number | null => (Number.isSafeInteger(value) ? (value as number) : null);

async function readStockBy(
  mode: { param: string; list: string; id: string },
  ids: number[],
): Promise<Map<number, ImsSizeStock> | null> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32 || ids.length === 0) return null;
  try {
    const found = new Map<number, ImsSizeStock>();
    // The storefront answers at most 200 ids per request.
    for (let start = 0; start < ids.length; start += 200) {
      const url = new URL("/api/internal/stock", origin);
      url.searchParams.set(mode.param, ids.slice(start, start + 200).join(","));
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${credential(secret, "stock")}` },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        console.error(`The storefront stock read answered ${response.status}`);
        return null;
      }
      const body = await response.json();
      if (!Array.isArray(body[mode.list])) {
        console.error(`The storefront stock read answered without a ${mode.list} list`);
        return null;
      }
      for (const item of body[mode.list] as Record<string, unknown>[]) {
        const id = item[mode.id];
        if (!Number.isSafeInteger(id)) continue;
        found.set(id as number, {
          sizeId: id as number, quantity: quantityOrNull(item.quantity), reserved: quantityOrNull(item.reserved), available: quantityOrNull(item.available),
        });
      }
    }
    return found;
  } catch (error) {
    console.error("The storefront stock read failed", error);
    return null;
  }
}

/** One Size the IMS holds, as its product feed lists it. A blank Variant is one unlabelled default Size. */
export interface ImsProduct { productId: number; name: string; variant: string | null; image: string | null; price: number | null; active: boolean }

/**
 * Reads the IMS product feed through the storefront, which holds the IMS credential. Called when Staff open
 * the page, never on a timer. Null means the feed could not be read, so the page lists nothing and says the IMS could not be reached.
 */
export async function readProductFeed(): Promise<ImsProduct[] | null> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return null;
  try {
    const response = await fetch(new URL("/api/internal/products", origin), {
      headers: { Authorization: `Bearer ${credential(secret, "stock")}` },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`The storefront product feed answered ${response.status}`);
      return null;
    }
    const body = await response.json();
    if (!Array.isArray(body.products)) {
      console.error("The storefront product feed answered without a products list");
      return null;
    }
    return (body.products as Record<string, unknown>[]).flatMap((item) =>
      Number.isSafeInteger(item.productId) ? [{
        productId: item.productId as number,
        name: typeof item.name === "string" ? item.name.trim() : "",
        variant: typeof item.variant === "string" && item.variant.trim() ? item.variant.trim() : null,
        image: typeof item.image === "string" && item.image.trim() ? item.image : null,
        price: typeof item.price === "number" && Number.isFinite(item.price) && item.price > 0 ? item.price : null,
        active: item.active !== false,
      }] : []);
  } catch (error) {
    console.error("The storefront product feed failed", error);
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

/** What Staff or a Manager decided on a Customer's cancellation request (before payment or preparing). Approving cancels the Order; declining needs a reason. */
export type CancelRequestDecision = { requestId: string; decision: "approved" } | { requestId: string; decision: "declined"; reason: string };

/** The storefront cancels the Order, releases its stock and emails the Customer on approval; never retried automatically. */
export async function decideCancelRequest(id: number, input: CancelRequestDecision, staff: { id: string; name: string }): Promise<OrderChangeResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL, secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  const uncertain = "Storefront could not confirm the decision. Refresh the Order before trying again.";
  try {
    const response = await fetch(new URL(`/api/internal/orders/${id}/cancel-request`, origin), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret)}` },
      body: JSON.stringify({ ...input, staffId: staff.id, staffName: staff.name }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body.error === "string" ? body.error : uncertain };
    if (body.id !== id || body.requestId !== input.requestId || body.status !== input.decision) return { ok: false, reason: uncertain };
    return { ok: true, order: { id, status: input.decision === "approved" ? "cancelled" : "unchanged", deliveryFeeInCentavos: null } };
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

export type RefundDestinationChangeResult = { ok: true; changedAt: Date } | { ok: false; reason: string };

/**
 * A Manager's change to a locked Refund destination, after the Customer confirmed the new one and before money is sent.
 * The storefront keeps the destination and records the change; CREOMS never writes the storefront's tables itself. The
 * request carries the full number because the storefront must store it; nothing here is logged or audited unmasked.
 */
export async function changeStorefrontRefundDestination(returnId: number, change: {
  method: string; accountName: string; accountNumber: string; bankName: string | null; reason: string; customerConfirmed: true;
}, staff: { id: string; name: string }): Promise<RefundDestinationChangeResult> {
  const origin = process.env.CREOMS_STOREFRONT_URL;
  const secret = process.env.CREOMS_SERVICE_SECRET;
  if (!origin || !secret || secret.length < 32) return { ok: false, reason: "Storefront is not configured." };
  const uncertain = "Storefront could not confirm the change. Refresh the Return before trying again.";
  try {
    const response = await fetch(new URL(`/api/internal/returns/${returnId}/refund-destination`, origin), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential(secret, "returns")}` },
      body: JSON.stringify({ ...change, staffId: staff.id, staffName: staff.name }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, reason: typeof body?.error === "string" ? body.error : "Storefront refused the change." };
    if (body?.returnId !== returnId || typeof body.changedAt !== "string" || !Number.isFinite(Date.parse(body.changedAt))) return { ok: false, reason: uncertain };
    return { ok: true, changedAt: new Date(body.changedAt) };
  } catch { return { ok: false, reason: uncertain }; }
}
