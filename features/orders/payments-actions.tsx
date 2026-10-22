"use client";

import { OrderActionDialog } from "./action-dialog";
import { cancelPaymentOrder, markPaid } from "./actions";
import type { OrderDetail } from "./orders";

/** Marks a GCash Order paid. No Reject: a Customer submits proof once, so Staff mark it paid or cancel the Order. */
export function MarkPaidDialog({ id, onMarkPaid }: { id: number; onMarkPaid?: () => void }) {
  return (
    <OrderActionDialog
      trigger="Mark paid"
      title={`Mark Order #${id} as paid?`}
      description="The Customer is told their payment was received."
      confirm="Mark paid"
      busy="Marking paid…"
      run={() => markPaid(id)}
      onOptimistic={onMarkPaid}
      successMessage={`Order #${id} marked paid.`}
    />
  );
}

/** The Payments Module's cancel, checked on its own Module rather than the Orders one. */
export function CancelPaymentDialog({ id }: { id: number }) {
  return (
    <OrderActionDialog
      trigger="Cancel order"
      title={`Cancel Order #${id}?`}
      description="This cannot be undone."
      confirm="Cancel order"
      busy="Cancelling…"
      keepLabel="Keep order"
      tone="destructive"
      run={() => cancelPaymentOrder(id)}
      successMessage={`Order #${id} cancelled.`}
    />
  );
}

/** Whether Staff can check this Order's Payment proof now: a GCash Order awaiting payment with proof submitted. */
function canCheckPayment(order: OrderDetail): boolean {
  return order.status === "awaiting payment" && order.paymentMethod === "gcash" && order.paymentProof !== null;
}

/**
 * The Payments Module's actions on an Order's detail. `withCancel` is false for Staff who also hold the
 * Orders Module, whose own actions already offer cancel.
 */
export function PaymentsActions({ order, withCancel }: { order: OrderDetail; withCancel: boolean }) {
  return (
    <>
      {withCancel && order.status === "awaiting payment" && <CancelPaymentDialog id={order.id} />}
      {canCheckPayment(order) && <MarkPaidDialog id={order.id} />}
    </>
  );
}
