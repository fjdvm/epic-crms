"use server";

import { revalidatePath } from "next/cache";

import { database } from "@/lib/db";
import { ORDERS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { changeOrderStatus, type OrderChangeResult } from "@/lib/storefront";

interface CurrentOrder {
  status: string;
  fulfillment_method: string;
}

const ALREADY_CHANGED = "Order already changed; refresh it before trying again.";

/** Authorize every direct call before reading Orders or using the service credential. */
async function act(
  id: number,
  run: (order: CurrentOrder) => Promise<OrderChangeResult>,
): Promise<OrderChangeResult> {
  // Portal redirects must propagate, rather than becoming an application error.
  await requireModule(ORDERS_MODULE);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Order number." };

  let result: OrderChangeResult;
  try {
    const [order] = await database()<CurrentOrder[]>`
      select status, fulfillment_method from public.orders where id = ${id}`;
    if (!order) return { ok: false, reason: "Order was not found." };
    result = await run(order);
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

export async function cancelOrder(id: number): Promise<OrderChangeResult> {
  return act(id, async (order) => {
    if (!["placed", "confirmed", "awaiting payment", "paid", "preparing"].includes(order.status)) {
      return { ok: false, reason: ALREADY_CHANGED };
    }
    return changeOrderStatus(id, { status: "cancelled" });
  });
}
