"use server";

import { revalidatePath } from "next/cache";

import { database } from "@/lib/db";
import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { gatewayAuditTrail, gatewayFileStorage } from "@/lib/gateway";
import { recordUpload } from "@/features/files/server";
import { FULFILMENT_MODULE, ORDERS_MODULE, PAYMENTS_MODULE } from "@/lib/portal/config";
import type { Staff } from "@/lib/portal/client";
import { requireShopWriter } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { changeOrderStatus, type OrderChangeResult } from "@/lib/storefront";

import { CANCELLABLE_STATUSES } from "./orders";
import { paymentQueue, paymentRows, type PaymentQueueResult, type PaymentsResult } from "./payments";
import { loadFulfilmentBoard, type FulfilmentBoardResult, readyToPrepare } from "./fulfilment";

interface CurrentOrder {
  status: string;
  fulfillment_method: string;
  payment_method: string;
  payment_proof_submitted_at: Date | null;
}

const ALREADY_CHANGED = "Order already changed; refresh it before trying again.";

/** Authorize every direct call before reading Orders or using the service credential. */
async function act(
  id: number,
  run: (order: CurrentOrder, staff: Staff) => Promise<OrderChangeResult>,
  requiredModule: string = ORDERS_MODULE,
  audit?: { action: string; description: (staff: Staff) => string },
): Promise<OrderChangeResult> {
  // Portal redirects must propagate, rather than becoming an application error.
  const staff = await requireModule(requiredModule);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Order number." };

  let result: OrderChangeResult;
  try {
    requireShopWriter(staff);
    const [order] = await database()<CurrentOrder[]>`
      select status, fulfillment_method, payment_method, payment_proof_submitted_at from public.orders where id = ${id}`;
    if (!order) return { ok: false, reason: "Order was not found." };
    result = await run(order, staff);
  } catch {
    return { ok: false, reason: "Order is temporarily unavailable." };
  }

  // Order writes are never optimistic, and a refusal must not look like a changed Order.
  if (result.ok) {
    if (audit) {
      await auditOrder(id, staff, requiredModule, audit.action, audit.description(staff));
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
async function auditOrder(id: number, staff: Staff, module: string, action: string, description: string) {
  await recordAudit(gatewayAuditTrail, {
    action, module, outcome: "success", actor: staffAuditActor(staff),
    target: { type: "order", id: String(id), display_name: `Order #${id}` },
    description, occurred_at: new Date().toISOString(), operationId: `order:${id}:${action}`,
  });
}

/** Quote in integer centavos; the storefront confirms the Delivery Order in the same write. */
export async function quoteDeliveryFee(id: number, deliveryFeeInCentavos: number): Promise<OrderChangeResult> {
  return act(id, async (order) => {
    if (!Number.isSafeInteger(deliveryFeeInCentavos) || deliveryFeeInCentavos < 0) {
      return { ok: false, reason: "Enter a nonnegative whole number of centavos." };
    }
    if (order.fulfillment_method !== "delivery") {
      return { ok: false, reason: "Only a placed Delivery Order can be quoted." };
    }
    if (order.status !== "placed") return { ok: false, reason: ALREADY_CHANGED };
    return changeOrderStatus(id, { status: "confirmed", deliveryFeeInCentavos });
  }, ORDERS_MODULE, {
    action: "order.delivery_fee_quoted",
    description: staff => `${staff.name} quoted a Delivery fee of ₱${(deliveryFeeInCentavos / 100).toFixed(2)} and confirmed Order #${id}.`,
  });
}

export async function confirmPickup(id: number): Promise<OrderChangeResult> {
  return act(id, async (order) => {
    if (order.status !== "placed") return { ok: false, reason: ALREADY_CHANGED };
    if (order.fulfillment_method !== "pickup") {
      return { ok: false, reason: "A Delivery Order needs a Delivery fee." };
    }
    return changeOrderStatus(id, { status: "confirmed" });
  }, ORDERS_MODULE, {
    action: "order.confirmed", description: staff => `${staff.name} confirmed Order #${id}.`,
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
    return { ok: true, rows: await paymentRows(database(), now), now };
  } catch {
    return { ok: false, reason: "Payments are temporarily unavailable." };
  }
}

/** Only the Portal may supply the identity; the storefront records the time. */
export async function markPaid(id: number): Promise<OrderChangeResult> {
  return act(id, async (order, staff) => {
    if (order.status !== "awaiting payment") return { ok: false, reason: ALREADY_CHANGED };
    if (order.payment_method !== "gcash" || !order.payment_proof_submitted_at) {
      return { ok: false, reason: "Only a GCash Order with submitted Payment proof can be marked paid." };
    }
    return changeOrderStatus(id, { status: "paid", staffId: staff.username, staffName: staff.name });
  }, PAYMENTS_MODULE, {
    action: "order.marked_paid", description: staff => `${staff.name} marked Order #${id} paid.`,
  });
}

/** Preparation uses the same readiness rule as the board; the storefront still owns the write. */
export async function startPreparing(id: number): Promise<OrderChangeResult> {
  return act(id, async (order) => {
    if (!readyToPrepare({ status: order.status, paymentMethod: order.payment_method })) {
      return { ok: false, reason: "Order is not ready to prepare or has already changed. Refresh it before trying again." };
    }
    return changeOrderStatus(id, { status: "preparing" });
  }, FULFILMENT_MODULE, {
    action: "order.preparing", description: staff => `${staff.name} started preparing Order #${id}.`,
  });
}

export async function dispatchOrder(id: number): Promise<OrderChangeResult> {
  return act(id, async (order) => {
    if (order.status !== "preparing") {
      return { ok: false, reason: "Only a preparing Order can be dispatched; it may have already changed. Refresh it before trying again." };
    }
    return changeOrderStatus(id, { status: "dispatched" });
  }, FULFILMENT_MODULE, {
    action: "order.dispatched", description: staff => `${staff.name} dispatched Order #${id}.`,
  });
}

/** The storefront records delivered_at, emails the Customer and starts its Feedback request timer. */
export async function deliverOrder(id: number, form?: FormData): Promise<OrderChangeResult> {
  return act(id, async (order, staff) => {
    if (order.status !== "dispatched") {
      return { ok: false, reason: "Only a dispatched Order can be delivered; it may have already changed. Refresh it before trying again." };
    }
    if (!(form instanceof FormData) || form.getAll("photo").length !== 1) {
      return { ok: false, reason: "Choose exactly one Delivery photo." };
    }
    let deliveryPhotoFileId: string;
    try {
      const upload = await recordUpload(FULFILMENT_MODULE, form.get("photo"), staff.username);
      if (!upload) return { ok: false, reason: "Choose exactly one Delivery photo." };
      deliveryPhotoFileId = upload.fileId;
    } catch {
      return { ok: false, reason: "Delivery photo could not be stored. The Order was not marked delivered." };
    }
    // Refused or uncertain writes leave Temporary evidence for file-storage's seven-day cleanup.
    const result = await changeOrderStatus(id, { status: "delivered", deliveryPhotoFileId });
    if (result.ok) {
      await auditOrder(id, staff, FULFILMENT_MODULE, "order.delivered", `${staff.name} marked Order #${id} delivered.`);
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
  try {
    requireShopWriter(staff);
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
