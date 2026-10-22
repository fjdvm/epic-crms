"use server";

import { revalidatePath } from "next/cache";

import { database } from "@/lib/db";
import { ORDERS_MODULE, PAYMENTS_MODULE } from "@/lib/portal/config";
import type { Staff } from "@/lib/portal/client";
import { requireModule } from "@/lib/portal/staff";
import { changeOrderStatus, type OrderChangeResult } from "@/lib/storefront";

import { paymentQueue, type PaymentQueueResult } from "./payments";

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
  module = ORDERS_MODULE,
): Promise<OrderChangeResult> {
  // Portal redirects must propagate, rather than becoming an application error.
  const staff = await requireModule(module);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Order number." };

  let result: OrderChangeResult;
  try {
    const [order] = await database()<CurrentOrder[]>`
      select status, fulfillment_method, payment_method, payment_proof_submitted_at from public.orders where id = ${id}`;
    if (!order) return { ok: false, reason: "Order was not found." };
    result = await run(order, staff);
  } catch {
    return { ok: false, reason: "Order is temporarily unavailable." };
  }

  // Order writes are never optimistic, and a refusal must not look like a changed Order.
  if (result.ok) {
    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/payments");
    revalidatePath("/fulfilment");
    revalidatePath("/customer-profiles", "layout");
  }
  return result;
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
  });
}

export async function confirmPickup(id: number): Promise<OrderChangeResult> {
  return act(id, async (order) => {
    if (order.status !== "placed") return { ok: false, reason: ALREADY_CHANGED };
    if (order.fulfillment_method !== "pickup") {
      return { ok: false, reason: "A Delivery Order needs a Delivery fee." };
    }
    return changeOrderStatus(id, { status: "confirmed" });
  });
}

/** The same cancel limit applies in Orders and Payments. */
async function cancel(id: number, module: string): Promise<OrderChangeResult> {
  return act(id, async (order) => {
    if (!["placed", "confirmed", "awaiting payment", "paid", "preparing"].includes(order.status)) {
      return { ok: false, reason: ALREADY_CHANGED };
    }
    return changeOrderStatus(id, { status: "cancelled" });
  }, module);
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

/** Only the Portal may supply the identity; the storefront records the time. */
export async function markPaid(id: number): Promise<OrderChangeResult> {
  return act(id, async (order, staff) => {
    if (order.status !== "awaiting payment") return { ok: false, reason: ALREADY_CHANGED };
    if (order.payment_method !== "gcash" || !order.payment_proof_submitted_at) {
      return { ok: false, reason: "Only a GCash Order with submitted Payment proof can be marked paid." };
    }
    return changeOrderStatus(id, { status: "paid", staffId: staff.username, staffName: staff.name });
  }, PAYMENTS_MODULE);
}
