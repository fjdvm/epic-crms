// Mirrors the storefront's lib/returns/refund-rules.ts (epic-crms#611). The storefront enforces these when it commits the refund;
// CREOMS checks first so Staff and Managers get the reason before they upload a proof or ask for approval.
/** Return reasons where the shop was at fault, so a Manager may include the Delivery fee in the refund. */
export const DELIVERY_FEE_REASONS = ["wrong item", "defective"] as const;

export interface RefundOrder {
  paymentMethod: string;
  fulfillmentMethod: string;
  subtotalInCentavos: number;
  approvedDiscountInCentavos: number | null;
  deliveryFeeInCentavos: number | null;
  totalInCentavos: number | null;
  codCollectedAmountInCentavos: number | null;
  codCollectedAt: Date | null;
}

/** What the Customer actually paid: the collected cash for a COD Order, otherwise the Order total after discounts. */
export function amountPaid(order: RefundOrder): number {
  const total = order.totalInCentavos ?? order.subtotalInCentavos - (order.approvedDiscountInCentavos ?? 0) + (order.deliveryFeeInCentavos ?? 0);
  return order.paymentMethod === "cash-on-delivery" && order.codCollectedAmountInCentavos !== null ? order.codCollectedAmountInCentavos : total;
}

export interface PriorRefund { itemsInCentavos: number; deliveryFeeInCentavos: number }

/**
 * The rules for money going back (#611). Returns the Delivery fee to refund with it (0 when none) or the reason it is refused.
 * Items first: the amount is what was paid for the approved whole line items after discounts, with no channel fee deducted.
 * The Delivery fee comes back only when a Manager asked for it with a reason, for a wrong or defective item, once per Order,
 * and never more than was charged.
 */
export function checkRefund(input: {
  order: RefundOrder;
  reason: string;
  itemsInCentavos: number;
  /** Refunds already completed on the same Order, other than this Return. */
  prior: PriorRefund[];
  /** Present when the caller asks for the Delivery fee to be included. */
  deliveryFeeReason?: string;
}): { ok: true; deliveryFeeInCentavos: number } | { ok: false; error: string } {
  const { order } = input;
  if (order.paymentMethod === "cash-on-delivery" && !order.codCollectedAt) {
    return { ok: false, error: "No cash was collected on this Cash on Delivery Order, so there is nothing to refund." };
  }
  let fee = 0;
  if (input.deliveryFeeReason !== undefined) {
    if (!input.deliveryFeeReason.trim()) return { ok: false, error: "Enter a reason for refunding the Delivery fee." };
    if (!(DELIVERY_FEE_REASONS as readonly string[]).includes(input.reason)) {
      return { ok: false, error: "The Delivery fee is refunded only for a wrong or defective item." };
    }
    if (input.prior.some((refund) => refund.deliveryFeeInCentavos > 0)) {
      return { ok: false, error: "The Delivery fee was already refunded on this Order." };
    }
    // Free delivery charged nothing, so it adds nothing.
    fee = order.fulfillmentMethod === "delivery" ? order.deliveryFeeInCentavos ?? 0 : 0;
  }
  const already = input.prior.reduce((sum, refund) => sum + refund.itemsInCentavos + refund.deliveryFeeInCentavos, 0);
  if (already + input.itemsInCentavos + fee > amountPaid(order)) {
    return { ok: false, error: "Refunds on this Order cannot add up to more than the Customer paid." };
  }
  return { ok: true, deliveryFeeInCentavos: fee };
}
