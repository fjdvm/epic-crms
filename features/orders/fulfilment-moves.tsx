"use client";

import { useState } from "react";
import { uploadFile } from "@/features/files/client";
import { importDeliveryPhotoLink } from "@/features/files/actions";

import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";

import { cn } from "@/lib/utils";

import { OrderActionDialog } from "./action-dialog";
import { deliverOrder, dispatchOrder, startPreparing } from "./actions";
import { CourierFields, useCourierForm } from "./courier-fields";
import { DeliveryPhotoPicker } from "./delivery-photo-picker";
import { LINK_MAX, linkProblem } from "./dispatch-record";
import { formatPesos } from "@/features/customer-profiles/format";
import { readyToPrepare } from "./fulfilment";

/** The status an Order shows at once after Staff confirm a move. */
export type MoveStatus = "preparing" | "dispatched" | "delivered";

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

/** Each phase's button has its own colour: brand purple to pack, blue to dispatch, green to deliver. */
const PACK_COLOUR = "bg-primary hover:bg-primary/90";
const DISPATCH_COLOUR = "bg-[#1d4ed8] hover:bg-[#1e40af]";
const DELIVER_COLOUR = "bg-[#15803d] hover:bg-[#166534]";

/** Lets the board open a move's dialog when a card is dropped. */
type DialogControl = { open?: boolean; onOpenChange?: (open: boolean) => void };

const totalText = (total: number) => (total / 100).toFixed(2);

type ProofSource = "upload" | "link";
const PROOF_SOURCES: { value: ProofSource; label: string }[] = [{ value: "upload", label: "Upload photo" }, { value: "link", label: "Paste image link" }];

/** Proof of delivery is required: an uploaded photo, or the image link copied from the Lalamove or Grab booking. */
function ProofOfDelivery({ source, onSource, photo, onPhoto, link, onLink, linkError }: {
  source: ProofSource; onSource: (source: ProofSource) => void; photo: File | null; onPhoto: (photo: File | null) => void;
  link: string; onLink: (link: string) => void; linkError: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p id="proof-of-delivery" className="text-[13px] font-medium text-foreground">Proof of delivery (required)</p>
        <p className="text-xs text-[#71717a]">Upload the photo, or paste the image link from Lalamove or Grab.</p>
        <div role="radiogroup" aria-labelledby="proof-of-delivery" className="flex gap-2">
          {PROOF_SOURCES.map(option => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={source === option.value}
              onClick={() => onSource(option.value)}
              className={`h-9 flex-1 rounded-lg border text-[13px] ${source === option.value ? "border-[#5b2a86] bg-[#f4effa] font-medium text-[#5b2a86]" : "border-[#e6e1ee]"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {source === "upload" ? <DeliveryPhotoPicker photo={photo} onChange={onPhoto} /> : (
        <div className="space-y-1.5">
          <Label htmlFor="delivery-photo-link" className="text-[13px] font-medium text-foreground">Delivery photo link</Label>
          <Input id="delivery-photo-link" type="url" autoComplete="off" placeholder="https://…" maxLength={LINK_MAX + 1} value={link}
            onChange={e => onLink(e.target.value)} aria-invalid={linkError ? true : undefined} />
          {linkError ? <p role="alert" className="text-xs text-[#dc2626]">{linkError}</p>
            : <p className="text-xs text-[#71717a]">We download the image and keep it as the Delivery photo. JPG or PNG, up to 5 MB.</p>}
        </div>
      )}
    </div>
  );
}

const PHOTO_LINK_REASON = "Paste the image link as a web address starting with https://.";

/** Marking delivered needs the proof of delivery, so this keeps the chosen file or pasted link for the dialog. */
function MarkDelivered({ id, cod, total, triggerClassName, onMove, ...control }: DialogControl & { id: number; cod: boolean; total: number; triggerClassName?: string; onMove?: (status: MoveStatus) => void }) {
  const [source, setSource] = useState<ProofSource>("upload");
  const [photo, setPhoto] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [collected, setCollected] = useState(totalText(total));
  const linkError = link.trim() && linkProblem(link) ? PHOTO_LINK_REASON : null;
  const proofReady = source === "upload" ? photo !== null : link.trim() !== "" && !linkError;

  return (
    <OrderActionDialog
      {...control}
      trigger="Mark as delivered"
      triggerClassName={cn(DELIVER_COLOUR, triggerClassName)}
      title={`Mark Order #${id} as delivered?`}
      description="The store records the delivery time now and emails the Customer."
      confirm="Mark as delivered"
      busy="Marking delivered…"
      disabled={!proofReady || (cod && Number.isNaN(centavosOf(collected)))}
      run={async () => {
        const uploaded = source === "upload" ? await uploadFile("Fulfilment", photo as File) : await importDeliveryPhotoLink(link.trim());
        if (!uploaded.ok) return uploaded;
        const form = new FormData();
        form.set("photo", uploaded.reference);
        if (source === "link") form.set("photoLink", link.trim());

        return deliverOrder(id, form, cod ? centavosOf(collected) : undefined);
      }}
      onOptimistic={onMove && (() => onMove("delivered"))}
      successMessage={`Order #${id} delivered.`}
    >
      <ProofOfDelivery source={source} onSource={setSource} photo={photo} onPhoto={setPhoto} link={link} onLink={setLink} linkError={linkError} />
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
function DispatchDelivery({ id, triggerClassName, onMove, ...control }: DialogControl & { id: number; triggerClassName?: string; onMove?: (status: MoveStatus) => void }) {
  const form = useCourierForm();

  return (
    <OrderActionDialog
      {...control}
      trigger="Mark as dispatched"
      triggerClassName={cn(DISPATCH_COLOUR, triggerClassName)}
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

/**
 * The Fulfilment Module's one next move for an Order, from a board card or the Order detail. An Order is
 * dispatched with its courier booking and then delivered.
 * Every move shows at once and rolls back with the reason if the server refuses.
 */
export function FulfilmentMove({
  order,
  triggerClassName,
  onMove,
  ...control
}: DialogControl & {
  order: { id: number; status: string; paymentMethod: string; total: number };
  triggerClassName?: string;
  /** Shows the Order in its next status at once; every move calls it, and a refusal rolls it back. */
  onMove?: (status: MoveStatus) => void;
}) {
  const { id } = order;

  if (readyToPrepare(order)) {
    return (
      <OrderActionDialog
        {...control}
        trigger="Pack order"
        triggerClassName={cn(PACK_COLOUR, triggerClassName)}
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
  if (order.status === "preparing") {
    return <DispatchDelivery {...control} id={id} triggerClassName={triggerClassName} onMove={onMove} />;
  }
  if (order.status === "dispatched") {
    return <MarkDelivered {...control} id={id} cod={order.paymentMethod === "cash-on-delivery"} total={order.total} triggerClassName={triggerClassName} onMove={onMove} />;
  }
  return null;
}
