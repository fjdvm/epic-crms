"use client";

import { useState } from "react";
import { uploadFile } from "@/features/files/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { OrderActionDialog } from "./action-dialog";
import { deliverOrder, dispatchOrder, markPickedUp, markReadyForPickup, startPreparing } from "./actions";
import { DeliveryPhotoPicker } from "./delivery-photo-picker";
import { readyToPrepare } from "./fulfilment";

/** Marking delivered needs the Delivery photo, so this keeps the chosen file for the dialog. */
function MarkDelivered({ id, triggerClassName }: { id: number; triggerClassName?: string }) {
  const [photo, setPhoto] = useState<File | null>(null);

  return (
    <OrderActionDialog
      trigger="Mark as delivered"
      triggerClassName={triggerClassName}
      title={`Mark Order #${id} as delivered?`}
      description="The store records the delivery time now and emails the Customer."
      confirm="Mark as delivered"
      busy="Marking delivered…"
      disabled={photo === null}
      run={async () => {
        const uploaded = await uploadFile("Fulfilment", photo as File);
        if (!uploaded.ok) return uploaded;
        const form = new FormData();
        form.set("photo", uploaded.reference);

        return deliverOrder(id, form);
      }}
      successMessage={`Order #${id} delivered.`}
    >
      <DeliveryPhotoPicker photo={photo} onChange={setPhoto} />
      {/* The Figma dialog's Feedback request row; the storefront always schedules it, so there is no toggle. */}
      <div className="space-y-1">
        <p className="font-medium text-foreground">Send Feedback request in 2 days</p>
        <p className="text-xs text-[#71717a]">Scheduled automatically by the store.</p>
      </div>
    </OrderActionDialog>
  );
}

const COURIERS = ["Lalamove", "Grab"] as const;

/**
 * A Delivery Order needs the courier and the booking's https share link, so Staff fill them in here. It emails the
 * Customer and sends the link outside the app, so it waits for the server instead of updating the screen first.
 */
function DispatchDelivery({ id, triggerClassName }: { id: number; triggerClassName?: string }) {
  const [courier, setCourier] = useState<string>("");
  const [link, setLink] = useState("");
  const [riderName, setRiderName] = useState("");
  const [riderPhone, setRiderPhone] = useState("");
  const [riderPlate, setRiderPlate] = useState("");
  const linkOk = /^https:\/\/\S+$/i.test(link.trim());

  return (
    <OrderActionDialog
      trigger="Mark as dispatched"
      triggerClassName={triggerClassName}
      title={`Mark Order #${id} as dispatched?`}
      description="Record the courier booking. The Customer is emailed once with the tracking link. A dispatched Order can no longer be cancelled."
      confirm="Mark as dispatched"
      busy="Dispatching…"
      disabled={!COURIERS.some(name => name === courier) || !linkOk}
      run={() => dispatchOrder(id, { courier, trackingUrl: link, riderName, riderPlate, riderPhone })}
      successMessage={`Order #${id} dispatched.`}
    >
      <div className="space-y-1.5">
        <Label htmlFor="courier" className="text-[13px] font-medium text-foreground">Courier</Label>
        <div id="courier" role="radiogroup" aria-label="Courier" className="flex gap-2">
          {COURIERS.map(name => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={courier === name}
              onClick={() => setCourier(name)}
              className={`h-9 flex-1 rounded-lg border text-[13px] ${courier === name ? "border-[#5b2a86] bg-[#f4effa] font-medium text-[#5b2a86]" : "border-[#e6e1ee]"}`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tracking-link" className="text-[13px] font-medium text-foreground">Booking share link</Label>
        <Input id="tracking-link" type="url" autoComplete="off" placeholder="https://…" value={link} onChange={e => setLink(e.target.value)} />
        {link.trim() && !linkOk ? <p className="text-xs text-[#dc2626]">The link must start with https://</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rider-name" className="text-[13px] font-medium text-foreground">Rider name (optional)</Label>
        <Input id="rider-name" autoComplete="off" value={riderName} onChange={e => setRiderName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="rider-contact" className="text-[13px] font-medium text-foreground">Rider contact (optional)</Label>
          <Input id="rider-contact" type="tel" autoComplete="off" value={riderPhone} onChange={e => setRiderPhone(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rider-plate" className="text-[13px] font-medium text-foreground">Plate no. (optional)</Label>
          <Input id="rider-plate" autoComplete="off" value={riderPlate} onChange={e => setRiderPlate(e.target.value)} />
        </div>
      </div>
    </OrderActionDialog>
  );
}

/**
 * The Fulfilment Module's one next move for an Order, from a board card or the Order detail. A Delivery Order is
 * dispatched with its courier booking and delivered; a Pickup Order is marked Ready for pickup and then Picked up.
 * Every move waits for the server and shows its refusal in plain words.
 */
export function FulfilmentMove({
  order,
  triggerClassName,
}: {
  order: { id: number; status: string; paymentMethod: string; fulfillmentMethod: string };
  triggerClassName?: string;
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
        successMessage={`Order #${id} is ready for pickup.`}
      />
    );
  }
  if (order.status === "preparing") {
    return <DispatchDelivery id={id} triggerClassName={triggerClassName} />;
  }
  // A legacy Pickup Order already dispatched is completed the same way.
  if (pickup && (order.status === "ready for pickup" || order.status === "dispatched")) {
    return (
      <OrderActionDialog
        trigger="Mark as picked up"
        triggerClassName={triggerClassName}
        title={`Mark Order #${id} as picked up?`}
        description="Confirm the Customer has collected it. The store records the pickup time now; Feedback is requested 2 days later."
        confirm="Mark as picked up"
        busy="Marking picked up…"
        run={() => markPickedUp(id)}
        successMessage={`Order #${id} picked up.`}
      />
    );
  }
  if (order.status === "dispatched") {
    return <MarkDelivered id={id} triggerClassName={triggerClassName} />;
  }
  return null;
}
