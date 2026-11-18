"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { database } from "@/lib/db";
import { crmsDatabase } from "@/lib/crms-db";
import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { gatewayAuditTrail, gatewayFileStorage } from "@/lib/gateway";
import { recordUpload } from "@/features/files/server";
import { FULFILMENT_MODULE, ORDERS_MODULE, PAYMENTS_MODULE } from "@/lib/portal/config";
import type { Staff } from "@/lib/portal/client";
import { canWork, shopRole, READ_ONLY_REASON } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { approvals } from "@/features/approvals/server";
import type { ApprovalResult } from "@/features/approvals/workflow";
import { isOccurrence, isStatusEmailKind, STATUS_EMAILS } from "./status-emails";
import { cancelStorefrontItems, changeOrderCourier, changeOrderStatus, resendOrderEmail, type ConfirmedAmounts, rejectStorefrontProof, type CodCollection, type CourierBooking, type OrderChangeResult } from "@/lib/storefront";
import { checkBooking, type CourierInput, type DispatchRecord } from "./dispatch-record";
import { loadDispatchRecord } from "./dispatch-record-read";
import { COD_CHOICES, COD_CHOICE_LABELS, type CodChoice } from "./cod-flags";
import { isPrepaid, MANAGER_AFTER_REJECTIONS } from "./payment-methods";

import { CANCELLABLE_STATUSES, failedEmails, loadOrder } from "./orders";
import { currentAutomaticChecks } from "@/features/settings/automatic-checks-server";
import { feeRefusal, freeDeliveryRule, type FreeDeliveryRule } from "./free-delivery";
import { reusedReferenceOrderIds } from "./payment-proof-checks";
import { alreadyFundedOrderIds, allocateReference, latestProofReference, releaseReference } from "./payment-allocations";
import { paymentQueue, paymentRows, type PaymentQueueResult, type PaymentsResult } from "./payments";
import { loadFulfilmentBoard, type FulfilmentBoardResult, readyToPrepare } from "./fulfilment";

interface CurrentOrder {
  status: string;
  fulfillment_method: string;
  payment_method: string;
  subtotal_in_centavos: number;
  delivery_fee_in_centavos: number | null;
  /** The free-delivery rule saved on the Order when it was placed; a null threshold means it was not judged yet. */
  free_delivery: boolean;
  free_delivery_threshold_in_centavos: number | null;
  /** The approved Senior/PWD discount saved on the Order; absent or 0 when it has none. */
  discount_in_centavos?: number | null;
  payment_proof_submitted_at: Date | null;
  payment_proof_rejected_at: Date | null;
  payment_proof_rejections: number;
  /** A Senior/PWD ID is still waiting for Staff; the Order is not confirmed until it is reviewed. */
  senior_pwd_pending: boolean;
}

const SENIOR_PWD_FIRST = "Review the Customer's Senior/PWD ID before confirming this Order.";
const ALREADY_CHANGED = "Order already changed; refresh it before trying again.";

/** Authorize every direct call before reading Orders or using the service credential. */
async function act<R extends OrderChangeResult | ApprovalResult = OrderChangeResult>(
  id: number,
  run: (order: CurrentOrder, staff: Staff) => Promise<R>,
  requiredModule: string = ORDERS_MODULE,
  audit?: { action: string; description: (staff: Staff) => string; metadata?: Record<string, unknown> },
): Promise<R | OrderChangeResult> {
  // Portal redirects must propagate, rather than becoming an application error.
  const staff = await requireModule(requiredModule);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Order number." };

  let result: R;
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  try {
    const [order] = await database()<CurrentOrder[]>`
      select status, fulfillment_method, payment_method, subtotal_in_centavos, delivery_fee_in_centavos, payment_proof_submitted_at,
        coalesce((to_jsonb(o) ->> 'discount_in_centavos')::int, 0) as discount_in_centavos,
        coalesce((to_jsonb(o) ->> 'free_delivery')::boolean, false) as free_delivery,
        (to_jsonb(o) ->> 'free_delivery_threshold_in_centavos')::bigint::float8 as free_delivery_threshold_in_centavos,
        payment_proof_rejected_at, payment_proof_rejections,
        exists (select 1 from public.senior_pwd_verifications v where v.id = o.senior_pwd_verification_id and v.status = 'pending') as senior_pwd_pending
      from public.orders o where o.id = ${id}`;
    if (!order) return { ok: false, reason: "Order was not found." };
    result = await run(order, staff);
  } catch {
    return { ok: false, reason: "Order is temporarily unavailable." };
  }

  // Order writes are never optimistic, and a refusal must not look like a changed Order.
  if (result.ok) {
    if (audit) {
      await auditOrder(id, staff, requiredModule, audit.action, audit.description(staff), audit.metadata);
    }
    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/payments");
    revalidatePath("/fulfilment");
    revalidatePath("/customer-profiles", "layout");
  }
  return result;
}

/** These transitions and the Delivery photo attachment happen at most once per Order. */
async function auditOrder(id: number, staff: Staff, module: string, action: string, description: string, metadata?: Record<string, unknown>) {
  await recordAudit(gatewayAuditTrail, {
    action, module, outcome: "success", actor: staffAuditActor(staff),
    target: { type: "order", id: String(id), display_name: `Order #${id}` },
    description, ...(metadata ? { metadata } : {}), occurred_at: new Date().toISOString(), operationId: `order:${id}:${action}`,
  });
}

/** What Staff chose on a flagged Cash on Delivery Order, worded for the log; nothing when there was none. */
function choiceNote(choice?: CodChoice): string {
  return choice && COD_CHOICES.includes(choice) ? ` after choosing "${COD_CHOICE_LABELS[choice]}"` : "";
}

const pesos = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;

/**
 * The final amounts for a confirmation, worked out from what the server holds. Staff confirm the total
 * they saw; if it no longer matches, nothing is sent or saved.
 */
function finalAmounts(order: CurrentOrder, staff: Staff, deliveryFeeInCentavos: number, expectedTotalInCentavos: number):
  { ok: true; amounts: ConfirmedAmounts } | { ok: false; reason: string } {
  const discountInCentavos = order.discount_in_centavos ?? 0;
  const totalInCentavos = order.subtotal_in_centavos - discountInCentavos + deliveryFeeInCentavos;
  if (expectedTotalInCentavos !== totalInCentavos) {
    return { ok: false, reason: `The total is now ${pesos(totalInCentavos)}, not ${pesos(Number.isFinite(expectedTotalInCentavos) ? expectedTotalInCentavos : 0)}. Refresh the Order before confirming.` };
  }
  return { ok: true, amounts: { subtotalInCentavos: order.subtotal_in_centavos, discountInCentavos, deliveryFeeInCentavos, totalInCentavos, staffId: staff.id, staffName: staff.name } };
}

const amountsMetadata = (a: { subtotalInCentavos: number; discountInCentavos: number; deliveryFeeInCentavos: number; totalInCentavos: number }) => ({
  subtotal_in_centavos: a.subtotalInCentavos, discount_in_centavos: a.discountInCentavos,
  delivery_fee_in_centavos: a.deliveryFeeInCentavos, total_in_centavos: a.totalInCentavos,
});

/** Quote in integer centavos; the storefront confirms the Delivery Order in the same write, after checking the final amounts. */
export async function quoteDeliveryFee(id: number, deliveryFeeInCentavos: number, expectedTotalInCentavos: number, codChoice?: CodChoice): Promise<OrderChangeResult> {
  let confirmed: ConfirmedAmounts | undefined;
  let freeDelivery: FreeDeliveryRule | undefined;
  return act(id, async (order, staff) => {
    if (!Number.isSafeInteger(deliveryFeeInCentavos) || deliveryFeeInCentavos < 0) {
      return { ok: false, reason: "Enter a nonnegative whole number of centavos." };
    }
    if (order.fulfillment_method !== "delivery") {
      return { ok: false, reason: "Only a placed Delivery Order can be quoted." };
    }
    if (order.senior_pwd_pending) return { ok: false, reason: SENIOR_PWD_FIRST };
    if (!CANCELLABLE_STATUSES.includes(order.status) || order.delivery_fee_in_centavos !== null) return { ok: false, reason: ALREADY_CHANGED };
    const rule = await freeDeliveryRule(database(), { freeDelivery: order.free_delivery, thresholdInCentavos: order.free_delivery_threshold_in_centavos },
      order.subtotal_in_centavos - (order.discount_in_centavos ?? 0));
    const refusal = feeRefusal(rule, deliveryFeeInCentavos);
    if (refusal) return { ok: false, reason: refusal };
    freeDelivery = rule.qualifies ? rule : undefined;
    const final = finalAmounts(order, staff, deliveryFeeInCentavos, expectedTotalInCentavos);
    if (!final.ok) return final;
    confirmed = final.amounts;
    return changeOrderStatus(id, { status: "confirmed", deliveryFeeInCentavos, amounts: final.amounts }, order.status === "placed" ? "confirmed" : order.status);
  }, ORDERS_MODULE, {
    action: "order.confirmed",
    description: staff => `${staff.name} ${deliveryFeeInCentavos === 0 ? "quoted free delivery (₱0.00)" : `quoted a Delivery fee of ${pesos(deliveryFeeInCentavos)}`} and confirmed Order #${id}${choiceNote(codChoice)}.`,
    get metadata() {
      if (!confirmed) return undefined;
      return freeDelivery
        ? { ...amountsMetadata(confirmed), free_delivery_applied: true, free_delivery_threshold_in_centavos: freeDelivery.thresholdInCentavos }
        : amountsMetadata(confirmed);
    },
  });
}

export async function confirmPickup(id: number, expectedTotalInCentavos: number, codChoice?: CodChoice): Promise<OrderChangeResult> {
  let confirmed: ConfirmedAmounts | undefined;
  return act(id, async (order, staff) => {
    if (order.status !== "placed") return { ok: false, reason: ALREADY_CHANGED };
    if (order.senior_pwd_pending) return { ok: false, reason: SENIOR_PWD_FIRST };
    if (order.fulfillment_method !== "pickup") {
      return { ok: false, reason: "A Delivery Order needs a Delivery fee." };
    }
    const final = finalAmounts(order, staff, 0, expectedTotalInCentavos);
    if (!final.ok) return final;
    confirmed = final.amounts;
    return changeOrderStatus(id, { status: "confirmed", amounts: final.amounts });
  }, ORDERS_MODULE, {
    action: "order.confirmed", description: staff => `${staff.name} confirmed Order #${id}${choiceNote(codChoice)}.`,
    get metadata() { return confirmed ? amountsMetadata(confirmed) : undefined; },
  });
}

/** The same cancel limit applies in Orders and Payments. */
async function cancel(id: number, module: string): Promise<OrderChangeResult> {
  return act(id, async (order) => {
    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      return { ok: false, reason: ALREADY_CHANGED };
    }
    return changeOrderStatus(id, { status: "cancelled" });
  }, module, {
    action: "order.cancelled", description: staff => `${staff.name} cancelled Order #${id}.`,
  });
}

/** Stable line identifiers for the item-cancellation confirmation. */
export async function loadCancellableOrderItems(id: number): Promise<
  { ok: true; items: { id: number; product: string; size: string; quantity: number; price: number }[] } |
  { ok: false; reason: string }
> {
  await requireModule(ORDERS_MODULE);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Order number." };
  try {
    const items = await database()<{ id: number; product: string; size: string; quantity: number; price: number }[]>`
      select l.id, l.product_name as product, l.size_label as size, l.quantity, l.price_in_centavos as price
      from public.order_lines l join public.orders o on o.id = l.order_id
      where o.id = ${id} and o.status in ('placed', 'confirmed', 'awaiting payment', 'paid', 'preparing') order by l.id`;
    return { ok: true, items };
  } catch { return { ok: false, reason: "Order items are temporarily unavailable." }; }
}

/** Whole line items only; the storefront recalculates the gross subtotal in the same transaction. */
export async function cancelOrderItems(id: number, lineIds: number[]): Promise<OrderChangeResult> {
  return act(id, async (order, staff) => {
    if (!Array.isArray(lineIds) || !lineIds.length || new Set(lineIds).size !== lineIds.length ||
        lineIds.some(lineId => !Number.isSafeInteger(lineId) || lineId < 1)) {
      return { ok: false, reason: "Choose this Order's whole line items to cancel." };
    }
    if (!CANCELLABLE_STATUSES.includes(order.status)) return { ok: false, reason: ALREADY_CHANGED };
    if ((order.status === "paid" || order.status === "preparing" && order.payment_method === "gcash") && shopRole(staff.role) !== "manager") {
      return { ok: false, reason: "Request approval from a CREOMS Manager to cancel paid items." };
    }
    const result = await cancelStorefrontItems(id, lineIds, staff, order.status);
    if (result.ok) await recordAudit(gatewayAuditTrail, {
      action: "order.items_cancelled", module: ORDERS_MODULE, outcome: "success", actor: staffAuditActor(staff),
      target: { type: "order", id: String(id), display_name: `Order #${id}` },
      description: `${staff.name} cancelled items on Order #${id}.`, metadata: { lineIds },
      occurred_at: new Date().toISOString(), operationId: `order:${id}:items-cancelled:${[...lineIds].sort((a,b) => a-b).join("-")}`,
    });
    return result;
  });
}

export async function cancelOrder(id: number): Promise<OrderChangeResult> {
  return cancel(id, ORDERS_MODULE);
}

export async function cancelPaymentOrder(id: number): Promise<OrderChangeResult> {
  return cancel(id, PAYMENTS_MODULE);
}

/** Queue reads are authorized too, even when called without opening the Payments page. */
export async function loadPaymentQueue(): Promise<PaymentQueueResult> {
  await requireModule(PAYMENTS_MODULE);
  try {
    return { ok: true, orders: await paymentQueue(database()) };
  } catch {
    return { ok: false, reason: "Payments are temporarily unavailable." };
  }
}

/** Everything the Payments page counts and lists, authorized like the queue. */
export async function loadPayments(): Promise<PaymentsResult> {
  await requireModule(PAYMENTS_MODULE);
  try {
    const now = new Date();
    return { ok: true, rows: await paymentRows(database(), now, await currentAutomaticChecks(), crmsDatabase()), now };
  } catch {
    return { ok: false, reason: "Payments are temporarily unavailable." };
  }
}

/** The Reason Staff or a Manager typed; blank counts as missing. */
const clean = (text: string | undefined) => (typeof text === "string" ? text.trim() : "");

/**
 * Marks a prepaid Order paid. Only the Portal may supply the identity; the storefront records the time.
 * After 3 rejected proofs this is "approve anyway": a Manager gives a reason, and Staff can only request approval.
 */
export async function markPaid(id: number, options: { reason?: string; approvalId?: string; allocateToOrderId?: number } = {}): Promise<OrderChangeResult | ApprovalResult> {
  let approvedAnyway: string | null = null;
  let reusedOn: number[] = [];
  let allocatedTo: number | null = null;
  let allocatedBy: { id: string; name: string } | null = null;
  return act<OrderChangeResult | ApprovalResult>(id, async (order, staff) => {
    if (order.status !== "awaiting payment") return { ok: false, reason: ALREADY_CHANGED };
    if (!isPrepaid(order.payment_method) || !order.payment_proof_submitted_at) {
      return { ok: false, reason: "Only an Order paid by GCash, Maya or bank transfer with submitted Payment proof can be marked paid." };
    }
    const rejections = Number(order.payment_proof_rejections ?? 0);
    // A reference already used on another Order stops Mark paid for everyone but a Manager, read on the server each time.
    reusedOn = await reusedReferenceOrderIds(database(), id, await currentAutomaticChecks());
    if (rejections < MANAGER_AFTER_REJECTIONS && reusedOn.length === 0) {
      if (order.payment_proof_rejected_at) return { ok: false, reason: "This proof was rejected. Wait for the Customer to send another." };
      return changeOrderStatus(id, { status: "paid", staffId: staff.username, staffName: staff.name });
    }
    if (rejections < MANAGER_AFTER_REJECTIONS && order.payment_proof_rejected_at) return { ok: false, reason: "This proof was rejected. Wait for the Customer to send another." };
    const reason = clean(options.reason);
    // The reason is needed to request, to approve anyway, and is checked again against the approved request.
    if (!options.approvalId && !reason) return { ok: false, reason: "Enter a reason to approve this payment anyway." };
    // A reused reference must say which Order the transfer pays: this one or one that already used it.
    const chosen = options.allocateToOrderId;
    if (reusedOn.length > 0 && (chosen === undefined || ![id, ...reusedOn].includes(chosen))) {
      return { ok: false, reason: "Choose which Order this transfer pays." };
    }
    return approvals().run(staff, { module: PAYMENTS_MODULE, action: "payment.approve-anyway", targetId: String(id),
      payload: { rejections, reusedReferenceOrderIds: reusedOn, ...(reusedOn.length ? { allocateToOrderId: chosen } : {}) }, amountInCentavos: 0 },
    { reason, approvalId: options.approvalId }, async () => {
      // A Staff retry names only the approval; the reason is the one they gave when they asked.
      if (!reason && options.approvalId) {
        const [asked] = await crmsDatabase()<{ reason: string }[]>`select reason from crms.approval_requests where id = ${options.approvalId}`;
        approvedAnyway = asked?.reason ?? "";
      } else approvedAnyway = reason;
      if (!approvedAnyway) return { ok: false, reason: "Enter a reason to approve this payment anyway." };
      let claimed: string | null = null;
      if (reusedOn.length > 0 && chosen !== undefined) {
        // The Manager who approved names the Order; a Staff retry carries the request's approver.
        allocatedBy = { id: staff.username, name: staff.name };
        if (options.approvalId) {
          const [approver] = await crmsDatabase()<{ manager_id: string | null; manager_name: string | null }[]>`select manager_id, manager_name from crms.approval_requests where id = ${options.approvalId}`;
          if (approver?.manager_id && approver.manager_name) allocatedBy = { id: approver.manager_id, name: approver.manager_name };
        }
        const reference = await latestProofReference(database(), id);
        if (!reference) return { ok: false, reason: "This proof has no reference to allocate." };
        // One transfer funds one Order: an Order that already moved past payment on it cannot be joined by another.
        const funded = (await alreadyFundedOrderIds(database(), reusedOn)).filter(n => n !== chosen);
        if (chosen === id && funded.length > 0) return { ok: false, reason: `This transfer already paid Order #${funded[0]}. It cannot fund a second Order.` };
        const holder = await allocateReference(crmsDatabase(), reference, { orderId: chosen, reason: approvedAnyway, by: allocatedBy });
        if (holder !== null) return { ok: false, reason: `This transfer was already allocated to Order #${holder}. It cannot fund a second Order.` };
        allocatedTo = chosen;
        if (chosen !== id) {
          await auditOrder(id, staff, PAYMENTS_MODULE, "payment.reference_allocated",
            `${allocatedBy.name} allocated the transfer on Order #${id} to Order #${chosen}: ${approvedAnyway}`,
            { reason: approvedAnyway, allocatedToOrderId: chosen, allocatedBy: allocatedBy.name, reusedReferenceOrderIds: reusedOn });
          return { ok: false, reason: `Transfer allocated to Order #${chosen}. It does not pay this Order: reject the proof or ask for a new one.` };
        }
        claimed = reference;
      }
      const paid = await changeOrderStatus(id, { status: "paid", staffId: staff.username, staffName: staff.name, approvedAnyway: { reason: approvedAnyway } });
      if (!paid.ok && claimed) await releaseReference(crmsDatabase(), claimed, id);
      return paid;
    });
  }, PAYMENTS_MODULE, {
    get action() { return approvedAnyway ? "payment.approved_anyway" : "payment.marked_paid"; },
    description: staff => approvedAnyway
      ? `${staff.name} approved Order #${id} anyway: ${approvedAnyway}`
      : `${staff.name} marked Order #${id} paid.`,
    get metadata() {
      return approvedAnyway ? { reason: approvedAnyway, ...(reusedOn.length ? { reusedReferenceOrderIds: reusedOn } : {}),
        ...(allocatedTo !== null && allocatedBy ? { allocatedToOrderId: allocatedTo, allocatedBy: allocatedBy.name } : {}) } : undefined;
    },
  });
}

/** Staff reject a proof with a reason. The storefront keeps the proof and reason, and emails the Customer a re-upload link once. */
export async function rejectPaymentProof(id: number, reason: string): Promise<OrderChangeResult> {
  const text = clean(reason);
  let rejections = 0;
  return act(id, async (order, staff) => {
    if (!text) return { ok: false, reason: "Enter a reason for rejecting the proof." };
    if (order.status !== "awaiting payment" || !isPrepaid(order.payment_method) || !order.payment_proof_submitted_at || order.payment_proof_rejected_at) {
      return { ok: false, reason: ALREADY_CHANGED };
    }
    const result = await rejectStorefrontProof(id, { reason: text, staffId: staff.username, staffName: staff.name });
    if (result.ok) rejections = result.rejections ?? 0;
    return result;
  }, PAYMENTS_MODULE, {
    action: "payment_proof.rejected",
    description: staff => `${staff.name} rejected the Payment proof on Order #${id}: ${text}`,
    get metadata() { return { reason: text, rejections }; },
  });
}

/** Preparation uses the same readiness rule as the board; the storefront still owns the write. */
export async function startPreparing(id: number): Promise<OrderChangeResult> {
  return act(id, async (order, staff) => {
    if (!readyToPrepare({ status: order.status, paymentMethod: order.payment_method })) {
      return { ok: false, reason: "Order is not ready to prepare or has already changed. Refresh it before trying again." };
    }
    return changeOrderStatus(id, { status: "preparing", staffId: staff.username, staffName: staff.name });
  }, FULFILMENT_MODULE);
}

const DELIVERY_ONLY = "That step is for a Delivery Order. A Pickup Order is marked Ready for pickup and then Picked up.";

/** A booking's audit values: the courier and link, never the rider's name, phone or plate. */
const bookingAudit = (booking: CourierBooking | undefined) => ({ courier: booking?.name ?? null, tracking_url: booking?.trackingUrl ?? null });

/** A Delivery Order needs its courier; the https link and rider details are optional and its storefront emails the link once. A Pickup Order is never dispatched. */
export async function dispatchOrder(id: number, courier?: CourierInput): Promise<OrderChangeResult> {
  let booking: CourierBooking | undefined;
  return act(id, async (order) => {
    if (order.fulfillment_method !== "delivery") return { ok: false, reason: DELIVERY_ONLY };
    if (order.status !== "preparing") {
      return { ok: false, reason: "Only a preparing Order can be dispatched; it may have already changed. Refresh it before trying again." };
    }
    const checked = checkBooking(courier);
    if (!checked.ok) return checked;
    booking = checked.booking;
    return changeOrderStatus(id, { status: "dispatched", courier: booking });
  }, FULFILMENT_MODULE, {
    action: "order.dispatched", description: staff => `${staff.name} dispatched Order #${id}${booking ? ` with ${booking.name}` : ""}.`,
    get metadata() { return { old: bookingAudit(undefined), new: bookingAudit(booking) }; },
  });
}

/** Staff add or fix the courier, link or rider details while the Order is still dispatched. Audited with the old and new values. */
export async function updateDispatchRecord(id: number, courier?: CourierInput): Promise<OrderChangeResult> {
  let before: DispatchRecord | null = null;
  let booking: CourierBooking | undefined;
  let riderChanged = false;
  return act(id, async (order, staff) => {
    if (order.fulfillment_method !== "delivery") return { ok: false, reason: DELIVERY_ONLY };
    if (order.status !== "dispatched") {
      return { ok: false, reason: "The booking can only be changed while the Order is dispatched; it may have already changed. Refresh it before trying again." };
    }
    const checked = checkBooking(courier);
    if (!checked.ok) return checked;
    // Staff and Managers do this work, so they may read the rider details to compare them.
    before = await loadDispatchRecord(database(), id, true);
    const next = checked.booking;
    const rider = (b: { riderName?: string; riderPlate?: string; riderPhone?: string } | null) => [b?.riderName, b?.riderPlate, b?.riderPhone].map(value => value ?? null);
    const old = before ? [before.rider?.name, before.rider?.plate, before.rider?.phone].map(value => value ?? null) : [null, null, null];
    riderChanged = JSON.stringify(old) !== JSON.stringify(rider(next));
    if (before && before.courier === next.name && (before.trackingUrl ?? undefined) === next.trackingUrl && !riderChanged) {
      return { ok: false, reason: "Nothing changed. Edit the courier, link or rider details first." };
    }
    booking = next;
    return changeOrderCourier(id, { courier: next, staffId: staff.username, staffName: staff.name });
  }, FULFILMENT_MODULE, {
    action: "order.dispatch_updated", description: staff => `${staff.name} changed the dispatch details of Order #${id}.`,
    get metadata() {
      return { old: bookingAudit(before ? { name: before.courier, trackingUrl: before.trackingUrl ?? undefined } : undefined), new: bookingAudit(booking), rider_details_changed: riderChanged };
    },
  });
}

const COD_AMOUNT_REASON = (total: number) => `The collected amount must equal the Order total of ${pesos(total)}. Enter that amount to record the payment.`;

/** A COD Order's completion carries the cash collected, and only the saved total is accepted; any other kind of Order records none. */
function codCollection(order: CurrentOrder, staff: Staff, collectedInCentavos: number | undefined): { ok: true; collection?: CodCollection } | { ok: false; reason: string } {
  if (order.payment_method !== "cash-on-delivery") return { ok: true };
  const total = order.subtotal_in_centavos - (order.discount_in_centavos ?? 0) + (order.delivery_fee_in_centavos ?? 0);
  if (collectedInCentavos !== total) return { ok: false, reason: COD_AMOUNT_REASON(total) };
  return { ok: true, collection: { amountInCentavos: total, staffId: staff.username, staffName: staff.name } };
}

/** The one audit event holds the transition, the amount, the time and the responsible Staff member. */
const collectionAudit = (collection: CodCollection | undefined, from: string, to: string) =>
  collection ? { cod_collected_in_centavos: collection.amountInCentavos, cod_collected_by: collection.staffName, cod_collected_at: new Date().toISOString(), from_status: from, to_status: to } : undefined;

/** A Pickup Order is packed and waiting at the shop; the storefront tells the Customer it can be collected. */
export async function markReadyForPickup(id: number): Promise<OrderChangeResult> {
  return act(id, async (order, staff) => {
    if (order.fulfillment_method !== "pickup") return { ok: false, reason: DELIVERY_ONLY };
    if (order.status !== "preparing") {
      return { ok: false, reason: "Only a preparing Pickup Order can be marked Ready for pickup; it may have already changed. Refresh it before trying again." };
    }
    return changeOrderStatus(id, { status: "ready for pickup", staffId: staff.username, staffName: staff.name });
  }, FULFILMENT_MODULE, {
    action: "order.ready_for_pickup", description: staff => `${staff.name} marked Pickup Order #${id} Ready for pickup.`,
  });
}

/** The Customer collected it. The storefront records collected_at, which counts like delivered_at. A legacy Pickup Order still `dispatched` can be completed too. */
export async function markPickedUp(id: number, collectedInCentavos?: number): Promise<OrderChangeResult> {
  let collection: CodCollection | undefined;
  let from = "ready for pickup";
  return act(id, async (order, staff) => {
    if (order.fulfillment_method !== "pickup") return { ok: false, reason: DELIVERY_ONLY };
    if (order.status !== "ready for pickup" && order.status !== "dispatched") {
      return { ok: false, reason: "Only a Pickup Order that is Ready for pickup can be marked Picked up; it may have already changed. Refresh it before trying again." };
    }
    from = order.status;
    const checked = codCollection(order, staff, collectedInCentavos);
    if (!checked.ok) return checked;
    collection = checked.collection;
    return changeOrderStatus(id, { status: "collected", staffId: staff.username, staffName: staff.name, ...(collection && { codCollection: collection }) });
  }, FULFILMENT_MODULE, {
    action: "order.picked_up",
    description: staff => `${staff.name} marked Pickup Order #${id} Picked up${collection ? ` and recorded ${pesos(collection.amountInCentavos)} collected` : ""}.`,
    // Read when the audit is written, after the move saved.
    get metadata() { return collectionAudit(collection, from, "collected"); },
  });
}

/** The storefront records delivered_at, emails the Customer and starts its Feedback request timer. */
export async function deliverOrder(id: number, form?: FormData, collectedInCentavos?: number): Promise<OrderChangeResult> {
  return act(id, async (order, staff) => {
    if (order.fulfillment_method !== "delivery") return { ok: false, reason: DELIVERY_ONLY };
    if (order.status !== "dispatched") {
      return { ok: false, reason: "Only a dispatched Order can be delivered; it may have already changed. Refresh it before trying again." };
    }
    if (!(form instanceof FormData) || form.getAll("photo").length !== 1) {
      return { ok: false, reason: "Choose exactly one Delivery photo." };
    }
    const checked = codCollection(order, staff, collectedInCentavos);
    if (!checked.ok) return checked;
    const collection = checked.collection;
    let deliveryPhotoFileId: string;
    try {
      const upload = await recordUpload(FULFILMENT_MODULE, form.get("photo"), staff.username);
      if (!upload) return { ok: false, reason: "Choose exactly one Delivery photo." };
      deliveryPhotoFileId = upload.fileId;
    } catch {
      return { ok: false, reason: "Delivery photo could not be stored. The Order was not marked delivered." };
    }
    // Refused or uncertain writes leave Temporary evidence for file-storage's seven-day cleanup.
    const result = await changeOrderStatus(id, { status: "delivered", deliveryPhotoFileId, ...(collection && { codCollection: collection }) });
    if (result.ok) {
      await auditOrder(id, staff, FULFILMENT_MODULE, "order.delivered",
        `${staff.name} marked Order #${id} delivered${collection ? ` and recorded ${pesos(collection.amountInCentavos)} collected` : ""}.`, collectionAudit(collection, "dispatched", "delivered"));
      await auditOrder(id, staff, FULFILMENT_MODULE, "order.delivery_photo_attached", `${staff.name} attached a Delivery photo to Order #${id}.`);
      try {
        await gatewayFileStorage.promote(deliveryPhotoFileId);
      } catch {
        return { ok: false, reason: "The Order was marked delivered, but its Delivery photo could not be made Permanent. Refresh the Order; do not repeat delivery." };
      }
    }
    return result;
  }, FULFILMENT_MODULE);
}

/** Public board read: Fulfilment access is proved on every request, like each move. */
export async function getFulfilmentBoard(): Promise<FulfilmentBoardResult> {
  await requireModule(FULFILMENT_MODULE);
  return loadFulfilmentBoard(database);
}

/** Settle uncertain delivery evidence from the recorded Order, never by replaying delivery. */
export async function reconcileDeliveryPhoto(id: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const staff = await requireModule(FULFILMENT_MODULE);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Order number." };
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  try {
    const [order] = await database()<{ status: string; file_id: string | null }[]>`
      select status, to_jsonb(o)->>'delivery_photo_file_id' as file_id from public.orders o where id = ${id}`;
    if (!order || !["delivered", "received"].includes(order.status) || !order.file_id) {
      return { ok: false, reason: "The Order has no confirmed Delivery photo. Refresh the Order before trying again." };
    }
    await gatewayFileStorage.promote(order.file_id);
    return { ok: true };
  } catch {
    return { ok: false, reason: "The Delivery photo could not be made Permanent. Refresh the Order; do not repeat delivery." };
  }
}

/** Packing-slip data omits payment evidence and permits read-only Fulfilment roles. */
export async function loadPackingSlip(id: number) {
  await requireModule(FULFILMENT_MODULE);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false as const, reason: "Invalid Order number." };
  const result = await loadOrder(database, id, await currentAutomaticChecks());
  if (!result.ok) return { ok: false as const, reason: "Packing slip is temporarily unavailable." };
  if (!result.order) return { ok: false as const, reason: "Order was not found." };
  const { id: orderId, createdAt, customer, fulfillmentMethod, lines, address } = result.order;
  try {
    const [row] = await database()<{ staff_id: string | null; staff_name: string | null; at: string | null }[]>`
      select to_jsonb(o)->>'packed_by_id' as staff_id, to_jsonb(o)->>'packed_by_name' as staff_name,
        to_jsonb(o)->>'packed_at' as at from public.orders o where id = ${id}`;
    return { ok: true as const, slip: { id: orderId, createdAt, customer, fulfillmentMethod, lines,
      address: fulfillmentMethod === "pickup" ? null : address,
      packedBy: row?.staff_id && row.staff_name && row.at ? { id: row.staff_id, name: row.staff_name, at: new Date(row.at) } : null,
    } };
  } catch { return { ok: false as const, reason: "Packing slip is temporarily unavailable." }; }
}

/**
 * Staff and Managers with the email's owning Module resend a Status email that failed after retries. It reaches
 * a Customer, so it waits for the server and is never optimistic. The storefront resends under the email's
 * stable id (reconciling first if Notification already accepted it), so a repeat never sends twice. Each Resend
 * is its own Audit Event (a fresh operation id) with the person's name; a refusal changes and audits nothing.
 */
export async function resendStatusEmail(id: number, kind: string, occurrence: string | null = null): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Order number." };
  if (!isStatusEmailKind(kind) || !isOccurrence(occurrence)) return { ok: false, reason: "Unknown email." };
  const staff = await requireModule(STATUS_EMAILS[kind].module);
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  try {
    const failed = await failedEmails(database(), id);
    if (!failed.some((email) => email.kind === kind && email.occurrence === occurrence)) return { ok: false, reason: "That email is not marked as failed. Refresh the Order." };
  } catch {
    return { ok: false, reason: "Order is temporarily unavailable." };
  }
  const result = await resendOrderEmail(id, { kind, occurrence }, { id: staff.id, name: staff.name });
  if (!result.ok) return result;
  await recordAudit(gatewayAuditTrail, {
    action: "order.email_resent", module: STATUS_EMAILS[kind].module, outcome: "success", actor: staffAuditActor(staff),
    target: { type: "order", id: String(id), display_name: `Order #${id}` },
    description: `${staff.name} resent the ${STATUS_EMAILS[kind].label} email for Order #${id}.`,
    metadata: { kind, ...(occurrence ? { occurrence } : {}), reconciled: result.reconciled }, occurred_at: new Date().toISOString(), operationId: `order:${id}:email-resend:${randomUUID()}`,
  });
  revalidatePath(`/orders/${id}`);
  return { ok: true };
}
