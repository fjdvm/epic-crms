"use client";

import { useState } from "react";
import { uploadFile } from "@/features/files/client";

import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";

import { OrderActionDialog } from "./action-dialog";
import { deliverOrder, dispatchOrder, markPickedUp, markReadyForPickup, startPreparing } from "./actions";
import { CourierFields, useCourierForm } from "./courier-fields";
import { DeliveryPhotoPicker } from "./delivery-photo-picker";
import { formatPesos } from "@/features/customer-profiles/format";
import { readyToPrepare } from "./fulfilment";

/** The status an Order shows at once after Staff confirm a move. */
export type MoveStatus = "preparing" | "dispatched" | "delivered" | "ready for pickup" | "collected";

/** What Staff typed as pesos, in centavos; NaN when it is not an amount. */
function centavosOf(text: string): number {
  const clean = text.replace(/[₱,\s]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : Number.NaN;
}

/**
 * A Cash on Delivery Order's completion records the cash collected in the same save. It is pre-filled with the saved
 * total; any other amount is refused by the server with the reason.
 */
function CollectedAmount({ move, total, value, onChange }: { move: string; total: number; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] font-medium text-foreground">{move}</p>
      <Label htmlFor="collected-amount" className="text-[13px] font-medium text-foreground">Payment collected (₱)</Label>
      <NumericInput id="collected-amount" kind="peso" autoComplete="off" value={value} onChange={e => onChange(e.target.value)} />
      <p className="text-xs text-[#71717a]">Order total {formatPesos(total)}. Recorded as Payment collected with your name and the time.</p>
    </div>
  );
}

const totalText = (total: number) => (total / 100).toFixed(2);

/** Marking delivered needs the Delivery photo, so this keeps the chosen file for the dialog. */
function MarkDelivered({ id, cod, total, triggerClassName, onMove }: { id: number; cod: boolean; total: number; triggerClassName?: string; onMove?: (status: MoveStatus) => void }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [collected, setCollected] = useState(totalText(total));

  return (
    <OrderActionDialog
      trigger="Mark as delivered"
      triggerClassName={triggerClassName}
      title={`Mark Order #${id} as delivered?`}
      description="The store records the delivery time now and emails the Customer."
      confirm="Mark as delivered"
      busy="Marking delivered…"
      disabled={photo === null || (cod && Number.isNaN(centavosOf(collected)))}
      run={async () => {
        const uploaded = await uploadFile("Fulfilment", photo as File);
        if (!uploaded.ok) return uploaded;
        const form = new FormData();
        form.set("photo", uploaded.reference);

        return deliverOrder(id, form, cod ? centavosOf(collected) : undefined);
      }}
      onOptimistic={onMove && (() => onMove("delivered"))}
      successMessage={`Order #${id} delivered.`}
    >
      <DeliveryPhotoPicker photo={photo} onChange={setPhoto} />
      {cod && <CollectedAmount move="Out for delivery → Delivered" total={total} value={collected} onChange={setCollected} />}
      {/* The Figma dialog's Feedback request row; the storefront always schedules it, so there is no toggle. */}
      <div className="space-y-1">
        <p className="font-medium text-foreground">Send Feedback request in 2 days</p>
        <p className="text-xs text-[#71717a]">Scheduled automatically by the store.</p>
      </div>
    </OrderActionDialog>
  );
}

/**
 * A Delivery Order needs the courier; the booking's https share link and rider details are optional and can be added later.
 * Dispatching shows the move at once and rolls back with the reason if the server refuses.
 */
function DispatchDelivery({ id, triggerClassName, onMove }: { id: number; triggerClassName?: string; onMove?: (status: MoveStatus) => void }) {
  const form = useCourierForm();

  return (
    <OrderActionDialog
      trigger="Mark as dispatched"
      triggerClassName={triggerClassName}
      title={`Mark Order #${id} as dispatched?`}
      description="Record the courier booking. The Customer is emailed once, with the tracking link if you add one. A dispatched Order can no longer be cancelled."
      confirm="Mark as dispatched"
      busy="Dispatching…"
      disabled={!form.valid}
      run={() => dispatchOrder(id, form.input)}
      onOptimistic={onMove && (() => onMove("dispatched"))}
      successMessage={`Order #${id} dispatched.`}
    >
      <CourierFields form={form} />
    </OrderActionDialog>
  );
}

function MarkPickedUp({ id, cod, total, pickupFrom, triggerClassName, onMove }: { id: number; cod: boolean; total: number; pickupFrom: string; triggerClassName?: string; onMove?: (status: MoveStatus) => void }) {
  const [collected, setCollected] = useState(totalText(total));

  return (
    <OrderActionDialog
      trigger="Mark as picked up"
      triggerClassName={triggerClassName}
      title={`Mark Order #${id} as picked up?`}
      description={cod
        ? "Confirm the Customer has collected it and paid. The store records the pickup time and the payment now; Feedback is requested 2 days later."
        : "Confirm the Customer has collected it. The store records the pickup time now; Feedback is requested 2 days later."}
      confirm="Mark as picked up"
      busy="Marking picked up…"
      disabled={cod && Number.isNaN(centavosOf(collected))}
      run={() => markPickedUp(id, cod ? centavosOf(collected) : undefined)}
      onOptimistic={onMove && (() => onMove("collected"))}
      successMessage={`Order #${id} picked up.`}
    >
      {cod && <CollectedAmount move={`${pickupFrom} → Picked up`} total={total} value={collected} onChange={setCollected} />}
    </OrderActionDialog>
  );
}

/**
 * The Fulfilment Module's one next move for an Order, from a board card or the Order detail. A Delivery Order is
 * dispatched with its courier booking and delivered; a Pickup Order is marked Ready for pickup and then Picked up.
 * Every move shows at once and rolls back with the reason if the server refuses.
 */
export function FulfilmentMove({
  order,
  triggerClassName,
  onMove,
}: {
  order: { id: number; status: string; paymentMethod: string; fulfillmentMethod: string; total: number };
  triggerClassName?: string;
  /** Shows the Order in its next status at once; every move calls it, and a refusal rolls it back. */
  onMove?: (status: MoveStatus) => void;
}) {
  const { id } = order;
  const pickup = order.fulfillmentMethod === "pickup";

  if (readyToPrepare(order)) {
    return (
      <OrderActionDialog
        trigger="Pack order"
        triggerClassName={triggerClassName}
        title={`Pack Order #${id}?`}
        description="Your name is recorded as the packer and the stock is deducted. The Order moves to Preparing; Staff with the Orders Module can still cancel it until it is dispatched."
        confirm="Pack order"
        busy="Packing…"
        run={() => startPreparing(id)}
        onOptimistic={onMove && (() => onMove("preparing"))}
        successMessage={`Order #${id} packed.`}
      />
    );
  }
  if (order.status === "preparing" && pickup) {
    return (
      <OrderActionDialog
        trigger="Mark ready for pickup"
        triggerClassName={triggerClassName}
        title={`Mark Order #${id} ready for pickup?`}
        description="The Customer is told their Order can be collected. A Pickup Order needs no courier or tracking link."
        confirm="Mark ready for pickup"
        busy="Marking ready…"
        run={() => markReadyForPickup(id)}
        onOptimistic={onMove && (() => onMove("ready for pickup"))}
        successMessage={`Order #${id} is ready for pickup.`}
      />
    );
  }
  if (order.status === "preparing") {
    return <DispatchDelivery id={id} triggerClassName={triggerClassName} onMove={onMove} />;
  }
  // A legacy Pickup Order already dispatched is completed the same way.
  if (pickup && (order.status === "ready for pickup" || order.status === "dispatched")) {
    return (
      <MarkPickedUp id={id} pickupFrom={order.status === "dispatched" ? "Out for delivery" : "Ready for pickup"} cod={order.paymentMethod === "cash-on-delivery"} total={order.total} triggerClassName={triggerClassName} onMove={onMove} />
    );
  }
  if (order.status === "dispatched") {
    return <MarkDelivered id={id} cod={order.paymentMethod === "cash-on-delivery"} total={order.total} triggerClassName={triggerClassName} onMove={onMove} />;
  }
  return null;
}
