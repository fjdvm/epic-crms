"use client";

import { OrderActionDialog } from "./action-dialog";
import { deliverOrder, dispatchOrder, startPreparing } from "./actions";
import { readyToPrepare } from "./fulfilment";

/**
 * The Fulfilment Module's one next move for an Order, from a board card or the Order detail. The
 * storefront has no courier or tracking number, so no move asks for one.
 */
export function FulfilmentMove({
  order,
  triggerClassName,
  onMove,
}: {
  order: { id: number; status: string; paymentMethod: string };
  triggerClassName?: string;
  /** Shows the Order in its next status at once; the moves without an outside effect call it. */
  onMove?: (status: "preparing" | "dispatched") => void;
}) {
  const { id } = order;

  if (readyToPrepare(order)) {
    return (
      <OrderActionDialog
        trigger="Start preparing"
        triggerClassName={triggerClassName}
        title={`Start preparing Order #${id}?`}
        description="The Order moves to Preparing. Staff with the Orders Module can still cancel it until it is dispatched."
        confirm="Start preparing"
        busy="Starting…"
        run={() => startPreparing(id)}
        onOptimistic={onMove && (() => onMove("preparing"))}
        successMessage={`Order #${id} is now preparing.`}
      />
    );
  }
  if (order.status === "preparing") {
    return (
      <OrderActionDialog
        trigger="Mark as dispatched"
        triggerClassName={triggerClassName}
        title={`Mark Order #${id} as dispatched?`}
        description="No courier or tracking number is needed. A dispatched Order can no longer be cancelled."
        confirm="Mark as dispatched"
        busy="Dispatching…"
        run={() => dispatchOrder(id)}
        onOptimistic={onMove && (() => onMove("dispatched"))}
        successMessage={`Order #${id} dispatched.`}
      />
    );
  }
  if (order.status === "dispatched") {
    return (
      <OrderActionDialog
        trigger="Mark as delivered"
        triggerClassName={triggerClassName}
        title={`Mark Order #${id} as delivered?`}
        description="The store records the delivery time now and emails the Customer."
        confirm="Mark as delivered"
        busy="Marking delivered…"
        run={() => deliverOrder(id)}
        successMessage={`Order #${id} delivered.`}
      >
        {/* The Figma dialog's Feedback request row; the storefront always schedules it, so there is no toggle. */}
        <div className="space-y-1">
          <p className="font-medium text-foreground">Send Feedback request in 2 days</p>
          <p className="text-xs text-[#71717a]">Scheduled automatically by the store.</p>
        </div>
      </OrderActionDialog>
    );
  }
  return null;
}
