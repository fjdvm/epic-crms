"use client";

import { Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { IMAGE_REFUSALS, MAX_IMAGE_BYTES } from "@/features/tickets/attachments";

/** What is wrong with a picked file, said before it travels. The server checks the real bytes again. */
function refusalFor(file: File): string | null {
  if (!/^image\/(jpeg|png)$/.test(file.type)) return IMAGE_REFUSALS["invalid-image-type"];
  if (file.size === 0) return IMAGE_REFUSALS["empty-image"];
  if (file.size > MAX_IMAGE_BYTES) return IMAGE_REFUSALS["image-too-large"];

  return null;
}

/** Picks the one Delivery photo, previews it, and reports a refusal in place. `photo` is only ever an accepted file. */
export function DeliveryPhotoPicker({ photo, onChange }: { photo: File | null; onChange: (photo: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const previewUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function pick(file: File | undefined) {
    if (!file) return;
    const reason = refusalFor(file);
    setRefusal(reason);
    onChange(reason ? null : file);
  }

  return (
    <div className="space-y-1.5">
      <span className="text-[13px] font-medium text-foreground">
        Delivery photo <span className="text-[#dc2626]">*</span>
      </span>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        aria-label="Delivery photo"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files[0]);
        }}
        className="flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-[#d4d4d8] bg-[#fafafa] py-3.5"
      >
        <Upload className="size-4.5 text-[#71717a]" aria-hidden />
        <span className="text-[13px] leading-[normal] font-medium text-[#3f3f46]">
          {photo ? photo.name : "Drag a photo here or click to upload"}
        </span>
        <span className="text-xs leading-[normal] text-[#a1a1aa]">JPG or PNG, up to 5 MB</span>
      </button>
      {refusal && (
        <p role="alert" className="text-xs text-[#b91c1c]">
          {refusal}
        </p>
      )}
      {photo && previewUrl && (
        <div className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={`Preview of ${photo.name}`} className="max-h-48 rounded-md border border-[#e6e1ee]" />
          <button type="button" onClick={() => {
              setRefusal(null);
              onChange(null);
            }} className="text-xs text-[#5b2a86]">
            Remove {photo.name}
          </button>
        </div>
      )}
    </div>
  );
}
