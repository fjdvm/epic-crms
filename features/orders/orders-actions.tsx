"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPesos, parsePesos } from "@/features/customer-profiles/format";

import { OrderActionDialog } from "./action-dialog";
import { cancelOrder, confirmPickup, quoteDeliveryFee } from "./actions";
import { CANCELLABLE_STATUSES, type OrderDetail } from "./orders";

function QuoteFee({ order }: { order: OrderDetail }) {
  const [text, setText] = useState("");
  // Staff's own notes from the Lalamove and Grab apps. They are never saved or sent: only the fee to charge is.
  const [lalamove, setLalamove] = useState("");
  const [grab, setGrab] = useState("");
  const fee = parsePesos(text);

  return (
    <OrderActionDialog
      trigger="Quote delivery fee"
      title={`Quote a Delivery fee for Order #${order.id}?`}
      description="Quoting the fee confirms the Order, and the Customer is told what they owe."
      confirm="Quote and confirm"
      busy="Confirming…"
      disabled={fee === null}
      run={() => quoteDeliveryFee(order.id, fee as number)}
      successMessage={`Order #${order.id} confirmed with a ${formatPesos(fee ?? 0)} Delivery fee.`}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="lalamove-estimate" className="text-[13px] font-medium text-foreground">Lalamove estimate</Label>
          <Input id="lalamove-estimate" autoComplete="off" placeholder="₱186 · motorcycle" value={lalamove} onChange={(e) => setLalamove(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grab-estimate" className="text-[13px] font-medium text-foreground">Grab estimate</Label>
          <Input id="grab-estimate" autoComplete="off" placeholder="₱204 · motorcycle" value={grab} onChange={(e) => setGrab(e.target.value)} />
        </div>
        <p className="col-span-2 text-xs text-[#71717a]">Optional. Check the apps yourself; these notes are not saved.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="delivery-fee" className="text-[13px] font-medium text-foreground">
          Delivery fee to charge (₱) <span className="text-[#dc2626]">*</span>
        </Label>
        <Input
          id="delivery-fee"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={text !== "" && fee === null}
        />
        {text !== "" && fee === null && (
          <p className="text-xs text-[#b91c1c]">Enter an amount in pesos, like 150 or 150.50.</p>
        )}
        <p className="text-xs text-[#71717a]">Customers see this as the final delivery fee.</p>
      </div>
      <dl className="space-y-1 text-[#1f1a2e]">
        <div className="flex justify-between">
          <dt className="text-[#6e6680]">Subtotal</dt>
          <dd>{formatPesos(order.subtotal)}</dd>
        </div>
        <div className="flex justify-between font-medium">
          <dt>New total</dt>
          <dd>{fee === null ? "—" : formatPesos(order.subtotal + fee)}</dd>
        </div>
      </dl>
    </OrderActionDialog>
  );
}

/** The Orders Module's actions: quote a fee or confirm a Pickup Order, and cancel. */
export function OrdersActions({ order }: { order: OrderDetail }) {
  if (order.status === "dispatched") {
    return <p className="text-sm text-[#6e6680]">A dispatched Order cannot be cancelled.</p>;
  }

  const placed = order.status === "placed";
  const pickup = order.fulfillmentMethod === "pickup";

  return (
    <>
      {CANCELLABLE_STATUSES.includes(order.status) && (
        <OrderActionDialog
          trigger="Cancel order"
          title={`Cancel Order #${order.id}?`}
          description="This cannot be undone."
          confirm="Cancel order"
          busy="Cancelling…"
          keepLabel="Keep order"
          tone="destructive"
          run={() => cancelOrder(order.id)}
          successMessage={`Order #${order.id} cancelled.`}
        />
      )}
      {!pickup && order.deliveryFee === null && CANCELLABLE_STATUSES.includes(order.status) && <QuoteFee order={order} />}
      {placed && pickup && (
        <OrderActionDialog
          trigger="Confirm order"
          title={`Confirm Order #${order.id}?`}
          description="This Pickup Order needs no Delivery fee."
          confirm="Confirm order"
          busy="Confirming…"
          run={() => confirmPickup(order.id)}
          successMessage={`Order #${order.id} confirmed.`}
        />
      )}
    </>
  );
}
