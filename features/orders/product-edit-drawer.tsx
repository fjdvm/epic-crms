"use client";

import { ImagePlus, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ZoomableImage } from "@/components/zoomable-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { uploadFile } from "@/features/files/client";

import { OrderActionDialog } from "./action-dialog";
import { publishProductContent } from "./product-content-actions";
import { MAX_DESCRIPTION } from "./product-content";
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

/** The new image Staff chose: uploaded already, published only when they confirm. */
interface Chosen { reference: string; preview: string }

function EditForm({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const [description, setDescription] = useState(row.description);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const preview = useRef<string | null>(null);

  useEffect(() => () => { if (preview.current) URL.revokeObjectURL(preview.current); }, []);

  async function choose(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setUploading(true);
    try {
      const result = await uploadFile("Orders", file);
      if (!result.ok) return setProblem(result.reason);
      if (preview.current) URL.revokeObjectURL(preview.current);
      preview.current = URL.createObjectURL(file);
      setChosen({ reference: result.reference, preview: preview.current });
    } catch {
      setProblem("The image could not be uploaded. Please try again.");
    } finally {
      setUploading(false);
      if (picker.current) picker.current.value = "";
    }
  }

  const shown = chosen?.preview ?? row.image;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
        <Locked id="product-title" label="Product" value={rowLabel(row)} />
        <div className="grid grid-cols-3 gap-3">
          <Locked id="product-in-stock" label="In stock" value={quantity(row.inStock)} />
          <Locked id="product-reserved" label="Reserved" value={quantity(row.reserved)} />
          <Locked id="product-available" label="Available online" value={quantity(row.available)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="product-image" className="text-[13px] font-medium text-[#52525b]">Image</Label>
          <div className="flex items-center gap-3">
            <div className="size-20 shrink-0 overflow-hidden rounded-lg border border-[#e6e1ee] bg-[#f5f2f9]">
              {shown && <ZoomableImage src={shown} alt={chosen ? "New image preview" : "Current image"} className="size-20 object-cover" />}
            </div>
            <div className="flex flex-col items-start gap-1">
              <Button type="button" variant="outline" disabled={uploading} onClick={() => picker.current?.click()} className="h-auto gap-2 rounded-lg px-3.5 py-[9px] shadow-none">
                {uploading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <ImagePlus aria-hidden className="size-4" />}
                {uploading ? "Uploading…" : shown ? "Replace image" : "Upload image"}
              </Button>
              <input
                ref={picker} id="product-image" type="file" accept="image/jpeg,image/png" aria-label="Product image" className="sr-only"
                onChange={(event) => void choose(event.target.files?.[0])}
              />
              <p className="text-xs text-[#6e6680]">JPG or PNG. Shown on the shop instead of the IMS image.</p>
              {problem && <p role="alert" className="text-xs text-[#b42318]">{problem}</p>}
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
        <Button type="button" variant="outline" onClick={onClose} className="h-auto rounded-lg px-4 py-[9px] shadow-none">Cancel</Button>
        <OrderActionDialog
          trigger="Publish to store" triggerDisabled={uploading}
          title="Publish to the store?" description={`Customers will see this image and description for ${rowLabel(row)}.`}
          confirm="Publish" busy="Publishing…" successMessage="Published to the store."
          run={async () => {
            const result = await publishProductContent(row.sizeId, description, chosen?.reference ?? null);
            if (result.ok) onClose();
            return result;
          }}
        />
      </div>
    </>
  );
}

/** Edit drawer for one product row: only the image and description change; the title and stock are shown locked. */
export function ProductEditDrawer({ row, onClose }: { row: StockRow | null; onClose: () => void }) {
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-[480px] flex-col gap-4 bg-white">
        <div className="flex flex-col gap-1">
          <SheetTitle className="text-lg font-semibold text-[#1f1a2e]">Edit product</SheetTitle>
          <SheetDescription className="text-sm text-[#6e6680]">Add an image and a description for the shop. The name and stock come from IMS.</SheetDescription>
        </div>
        {row && <EditForm key={row.sizeId} row={row} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}
