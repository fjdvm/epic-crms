"use client";

import { ImagePlus, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ZoomableImage } from "@/components/zoomable-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

import { OrderActionDialog } from "./action-dialog";
import { publishProductContent, removeFromStore, setProductPrice } from "./product-content-actions";
import { uploadProductImage } from "./product-image-upload";
import { MAX_DESCRIPTION, MAX_NAME, parsePrice } from "./product-content-limits";
import { rowLabel, type StockRow } from "./stock";

const quantity = (value: number | null) => (value === null ? "–" : String(value));

function Locked({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[13px] font-medium text-[#52525b]">{label}</Label>
      <Input id={id} value={value} disabled readOnly className="bg-[#f5f2f9] text-[#18181b] disabled:opacity-100" />
    </div>
  );
}

const peso = (value: number) => `₱${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The shop price. It is money, so it never goes with the publish: a Manager sets it on its own confirm, with a spinner
 * until the server answers; Staff see it read-only and ask a Manager with a reason. The IMS price is never changed.
 */
function PriceField({ row, canPrice }: { row: StockRow; canPrice: boolean }) {
  const [typed, setTyped] = useState(row.price === null ? "" : row.price.toFixed(2));
  const [reason, setReason] = useState("");
  const price = parsePrice(typed);
  const unchanged = price !== null && price === row.price;
  const input = (
    <NumericInput
      kind="peso" id={`product-price-${canPrice ? "set" : "ask"}`} value={typed} onChange={(event) => setTyped(event.target.value)}
      placeholder="0.00" aria-label="Shop price in pesos" className="text-[#18181b]"
    />
  );
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="product-price-current" className="text-[13px] font-medium text-[#52525b]">Shop price</Label>
      {canPrice ? (
        <div className="flex items-start gap-2">
          <div className="flex-1">{input}</div>
          <OrderActionDialog
            trigger="Set price" triggerVariant="outline" triggerDisabled={price === null || unchanged}
            title="Set the shop price?" description={`Customers will pay ${price === null ? "this" : peso(price)} for ${rowLabel(row)}. The IMS price stays as it is.`}
            confirm="Set price" busy="Saving…" successMessage="Shop price set."
            run={() => setProductPrice(row.sizeId, typed)}
          />
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Input id="product-price-current" value={row.price === null ? "Not set" : peso(row.price)} disabled readOnly className="flex-1 bg-[#f5f2f9] text-[#18181b] disabled:opacity-100" />
          <OrderActionDialog
            trigger="Request approval…" triggerVariant="outline"
            title="Ask a Manager to set the price" description={`${rowLabel(row)}. Shop prices need a Manager. Suggest one and say why.`}
            confirm="Send request" busy="Sending…" disabled={price === null || unchanged || !reason.trim()}
            successMessage="Sent to a Manager. The price changes once they approve."
            run={async () => {
              const result = await setProductPrice(row.sizeId, typed, reason);
              // A waiting request is the expected answer here, not a refusal.
              return !result.ok && result.reason === "Waiting for approval" ? { ok: true as const } : result;
            }}
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="product-price-ask" className="text-[13px] font-medium text-foreground">Suggested price</Label>
                {input}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-price-reason" className="text-[13px] font-medium text-foreground">Reason</Label>
                <Textarea id="product-price-reason" value={reason} maxLength={1000} rows={3} onChange={(event) => setReason(event.target.value)} className="resize-none" />
              </div>
            </div>
          </OrderActionDialog>
        </div>
      )}
      <p className="text-xs text-[#6e6680]">{canPrice ? "Only in CREOMS: the IMS price is not changed." : "Only a Manager sets the shop price."} The shop sells a product once it has a price and an image.</p>
    </div>
  );
}

/** The new image Staff chose: uploaded already, published only when they confirm. */
interface Chosen { reference: string; preview: string }

export const IMAGE_REQUIRED = "Add an image before publishing. The shop shows a product only once it has one.";

/** What the success message says: when the product is not yet complete, what it still waits for. */
function publishedMessage(price: number | null, removed: boolean): string {
  if (price === null) return "Published. It shows on the shop once a Manager sets the price.";
  return removed ? "Back on the store." : "Published to the store.";
}

function EditForm({ row, canPrice, onClose }: { row: StockRow; canPrice: boolean; onClose: () => void }) {
  const [description, setDescription] = useState(row.description);
  // Empty means the IMS name; what is shown starts from CREOMS's own name, if it set one.
  const [name, setName] = useState(row.product === row.imsName ? "" : row.product);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [imageMissing, setImageMissing] = useState(false);
  const imageButton = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const preview = useRef<string | null>(null);

  useEffect(() => () => { if (preview.current) URL.revokeObjectURL(preview.current); }, []);

  async function choose(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setUploading(true);
    try {
      const result = await uploadProductImage(file);
      if (!result.ok) return setProblem(result.reason);
      if (preview.current) URL.revokeObjectURL(preview.current);
      preview.current = URL.createObjectURL(file);
      setChosen({ reference: result.reference, preview: preview.current });
      setImageMissing(false);
    } catch {
      setProblem("The image could not be uploaded. Please try again.");
    } finally {
      setUploading(false);
      if (picker.current) picker.current.value = "";
    }
  }

  const shown = chosen?.preview ?? row.image;
  // The shop needs CREOMS's own image; an IMS image only shows here, for reference.
  const hasImage = chosen !== null || row.hasShopImage;
  const imsImageOnly = chosen === null && !row.hasShopImage && row.image !== null;
  const removed = row.marker?.kind === "removed";

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-name" className="text-[13px] font-medium text-[#52525b]">Shop name</Label>
          <Input
            id="product-name" value={name} maxLength={MAX_NAME} placeholder={row.imsName}
            onChange={(event) => setName(event.target.value)} className="text-[#18181b]"
          />
          <p className="text-xs text-[#6e6680]">IMS name: {row.imsName}{row.size ? ` · ${row.size}` : ""}. Leave empty to use it. Only in CREOMS: the IMS keeps its own name.</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Locked id="product-in-stock" label="In stock" value={quantity(row.inStock)} />
          <Locked id="product-reserved" label="Reserved" value={quantity(row.reserved)} />
          <Locked id="product-available" label="Available online" value={quantity(row.available)} />
        </div>

        <PriceField row={row} canPrice={canPrice} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-image" className="text-[13px] font-medium text-[#52525b]">Image</Label>
          <div className="flex items-center gap-3">
            <div className="size-20 shrink-0 overflow-hidden rounded-lg border border-[#e6e1ee] bg-[#f5f2f9]">
              {shown && <ZoomableImage src={shown} alt={chosen ? "New image preview" : "Current image"} className="size-20 object-cover" />}
            </div>
            <div className="flex flex-col items-start gap-1">
              <Button ref={imageButton} type="button" variant="outline" disabled={uploading} onClick={() => picker.current?.click()} className="h-auto gap-2 rounded-lg px-3.5 py-[9px] shadow-none">
                {uploading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <ImagePlus aria-hidden className="size-4" />}
                {uploading ? "Uploading…" : hasImage ? "Replace image" : "Upload image"}
              </Button>
              <input
                ref={picker} id="product-image" type="file" accept="image/jpeg,image/png" aria-label="Product image" className="sr-only"
                onChange={(event) => void choose(event.target.files?.[0])}
              />
              <p className="text-xs text-[#6e6680]">
                {imsImageOnly ? "IMS image, not on the shop. Upload a JPG or PNG for the shop." : "JPG or PNG, up to 5 MB. Required: the shop shows a product only once it has one."}
              </p>
              {problem && <p role="alert" className="text-xs text-[#b42318]">{problem}</p>}
              {imageMissing && !problem && <p role="alert" className="text-xs text-[#b42318]">{IMAGE_REQUIRED}</p>}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-description" className="text-[13px] font-medium text-[#52525b]">Description</Label>
          <Textarea
            id="product-description" value={description} maxLength={MAX_DESCRIPTION} rows={6}
            onChange={(event) => setDescription(event.target.value)} className="resize-none text-[#18181b]"
          />
          <p className="text-right text-xs text-[#6e6680]">{description.length}/{MAX_DESCRIPTION}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#f0f0f2] pt-4">
        {row.marker === null && (
          <div className="mr-auto">
            <OrderActionDialog
              trigger="Remove from store" tone="destructive" triggerDisabled={uploading}
              title="Remove from the store?"
              description={`Customers will no longer see or order ${rowLabel(row)}. Open Orders keep their items. Publish it again to put it back.`}
              confirm="Remove" busy="Removing…" successMessage="Removed from the store."
              run={async () => {
                const result = await removeFromStore(row.sizeId);
                if (result.ok) onClose();
                return result;
              }}
            />
          </div>
        )}
        <Button type="button" variant="outline" onClick={onClose} className="h-auto rounded-lg px-4 py-[9px] shadow-none">Cancel</Button>
        {hasImage ? (
          <OrderActionDialog
            trigger="Publish to store" triggerDisabled={uploading}
            title={removed ? "Put it back on the store?" : "Publish to the store?"}
            description={`Customers will see this name, image and description for ${rowLabel(row)}.`}
            confirm="Publish" busy="Publishing…" successMessage={publishedMessage(row.price, removed)}
            run={async () => {
              const result = await publishProductContent(row.sizeId, description, chosen?.reference ?? null, name);
              if (result.ok) onClose();
              return result;
            }}
          />
        ) : (
          // No image yet: say so where the image goes, instead of opening the confirm.
          <Button type="button" disabled={uploading} onClick={() => { setImageMissing(true); imageButton.current?.focus(); }} className="h-auto rounded-lg px-4 py-[9px]">
            Publish to store
          </Button>
        )}
      </div>
    </>
  );
}

/**
 * Edit drawer for one product row: the shop name, image, description and (Managers) price change, in CREOMS only.
 * The stock is shown locked: the IMS owns it.
 */
export function ProductEditDrawer({ row, canPrice = false, onClose }: { row: StockRow | null; canPrice?: boolean; onClose: () => void }) {
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-[480px] flex-col gap-4 bg-white">
        <div className="flex flex-col gap-1">
          <SheetTitle className="text-lg font-semibold text-[#1f1a2e]">Edit product</SheetTitle>
          <SheetDescription className="text-sm text-[#6e6680]">Set what the shop shows. These edits stay in CREOMS; the stock comes from the IMS.</SheetDescription>
        </div>
        {row && <EditForm key={row.sizeId} row={row} canPrice={canPrice} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}
