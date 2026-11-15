"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPesos, parsePesos } from "@/features/customer-profiles/format";

import { OrderActionDialog, type ChangeResult } from "./action-dialog";
import { cancelOrder, confirmPickup, quoteDeliveryFee } from "./actions";
import { recordAskGcashFirst } from "./cod-actions";
import { CodConfirmPanel, type CodFlagLine } from "./cod-confirm";
import type { CodChoice } from "./cod-flags";
import { CANCELLABLE_STATUSES, type OrderDetail } from "./orders";

/** With flags, Staff must pick what to do first; "ask for GCash" leaves the Order as it is and only logs the choice. */
function useCodChoice(order: OrderDetail, flags: readonly CodFlagLine[], confirmRun: (choice?: CodChoice) => Promise<ChangeResult>, confirmed: string) {
  const [choice, setChoice] = useState<CodChoice | null>(null);
  const flagged = flags.length > 0;
  const asking = choice === "ask-gcash";
  return {
    disabled: flagged && choice === null,
    run: () => (asking ? recordAskGcashFirst(order.id) : confirmRun(flagged ? choice ?? undefined : undefined)),
    successMessage: asking ? `Order #${order.id} left as it is. Ask the Customer to pay by GCash first.` : confirmed,
    panel: flagged ? <CodConfirmPanel flags={flags} choice={choice} onChoose={setChoice} /> : null,
    flagged,
    asking,
  };
}

function QuoteFee({ order, flags }: { order: OrderDetail; flags: readonly CodFlagLine[] }) {
  const [text, setText] = useState("");
  // Staff's own notes from the Lalamove and Grab apps. They are never saved or sent: only the fee to charge is.
  const [lalamove, setLalamove] = useState("");
  const [grab, setGrab] = useState("");
  const fee = parsePesos(text);
  const cod = useCodChoice(order, flags, (choice) => (choice ? quoteDeliveryFee(order.id, fee as number, choice) : quoteDeliveryFee(order.id, fee as number)), `Order #${order.id} confirmed with a ${formatPesos(fee ?? 0)} Delivery fee.`);

  return (
    <OrderActionDialog
      trigger="Quote delivery fee"
      title={`Quote a Delivery fee for Order #${order.id}?`}
      description="Quoting the fee confirms the Order, and the Customer is told what they owe."
      confirm={cod.asking ? "Save" : cod.flagged ? "Save & continue" : "Quote and confirm"}
      busy={cod.asking ? "Saving…" : "Confirming…"}
      disabled={cod.disabled || (!cod.asking && fee === null)}
      run={cod.run}
      successMessage={cod.successMessage}
    >
      {cod.panel}
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

function ConfirmPickup({ order, flags }: { order: OrderDetail; flags: readonly CodFlagLine[] }) {
  const cod = useCodChoice(order, flags, (choice) => (choice ? confirmPickup(order.id, choice) : confirmPickup(order.id)), `Order #${order.id} confirmed.`);
  return (
    <OrderActionDialog
      trigger="Confirm order"
      title={`Confirm Order #${order.id}?`}
      description="This Pickup Order needs no Delivery fee."
      confirm={cod.asking ? "Save" : cod.flagged ? "Save & continue" : "Confirm order"}
      busy={cod.asking ? "Saving…" : "Confirming…"}
      disabled={cod.disabled}
      run={cod.run}
      successMessage={cod.successMessage}
    >
      {cod.panel}
    </OrderActionDialog>
  );
}

/** The Orders Module's actions: quote a fee or confirm a Pickup Order, and cancel. */
export function OrdersActions({ order, codFlags = [] }: { order: OrderDetail; codFlags?: readonly CodFlagLine[] }) {
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
      {!pickup && order.deliveryFee === null && CANCELLABLE_STATUSES.includes(order.status) && <QuoteFee order={order} flags={codFlags} />}
      {placed && pickup && <ConfirmPickup order={order} flags={codFlags} />}
    </>
  );
}
