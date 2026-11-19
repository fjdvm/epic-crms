"use client";

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { uploadFile } from "@/features/files/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { changePaymentAccountQr } from "./payment-actions";
import { ZoomableImage } from "@/components/zoomable-image";

const MAX_BYTES = 5 * 1024 * 1024;

/** Quick feedback only; the server checks the real file content again. */
export function checkQrFile(file: { type: string; size: number }): string | null {
  if (file.type !== "image/jpeg" && file.type !== "image/png") return "Only a JPG or PNG image can be used as the QR.";
  if (file.size === 0) return "That image is empty. Choose a JPG or PNG with something in it.";
  if (file.size > MAX_BYTES) return "That image is over 5 MB. Choose a smaller JPG or PNG.";
  return null;
}

/** Attach, replace or remove an account's optional QR. Not optimistic: the new image shows once the server accepts it. */
export function PaymentAccountQr({ accountId, label, hasQr }: { accountId: string; label: string; hasQr: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (reason: string) => { setError(reason); toast.error(reason); };
  const finish = (result: { ok: true } | { ok: false; reason: string }, done: string) => {
    if (result.ok) { setError(null); toast.success(done); router.refresh(); } else fail(result.reason);
  };

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = checkQrFile(file);
    if (problem) return fail(problem);
    setBusy(true); setError(null);
    try {
      const uploaded = await uploadFile("Management", file);
      if (!uploaded.ok) return fail(uploaded.reason);
      finish(await changePaymentAccountQr(accountId, uploaded.reference), "QR image saved.");
    } finally { setBusy(false); }
  }

  async function onRemove() {
    setBusy(true); setError(null);
    try { finish(await changePaymentAccountQr(accountId, null), "QR image removed."); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <input ref={input} type="file" accept="image/jpeg,image/png" className="sr-only" aria-label={`QR image for ${label}`} onChange={onPick} />
      {!hasQr ? (
        <Button type="button" variant="outline" className="h-auto rounded-lg border border-[#e6e1ee] bg-transparent px-4 py-[9px] leading-[normal] text-[#1f1a2e] shadow-none hover:bg-[#f7f5fa]" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Saving…" : "Add QR"}
        </Button>
      ) : (
        <>
          <Button type="button" variant="outline" aria-expanded={open} aria-controls={`qr-${accountId}`} className="h-auto rounded-lg border border-[#e6e1ee] bg-transparent px-4 py-[9px] leading-[normal] text-[#1f1a2e] shadow-none hover:bg-[#f7f5fa] inline-flex items-center gap-1.5" onClick={() => setOpen((v) => !v)}>
            QR
            <ChevronDown aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")} />
          </Button>
          {open && (
            <div id={`qr-${accountId}`} className="flex flex-col items-center gap-2">
              <ZoomableImage src={`/api/payment-accounts/${accountId}/qr`} alt={`QR for ${label}`} className="size-24 rounded-md border border-[#e6e1ee] object-contain" />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" className="h-auto rounded-lg border border-[#e6e1ee] bg-transparent px-4 py-[9px] leading-[normal] text-[#1f1a2e] shadow-none hover:bg-[#f7f5fa]" disabled={busy} onClick={() => input.current?.click()}>
                  {busy ? "Saving…" : "Replace QR"}
                </Button>
                <Button type="button" variant="outline" className="h-auto rounded-lg border border-[#e6e1ee] bg-transparent px-4 py-[9px] leading-[normal] text-[#1f1a2e] shadow-none hover:bg-[#f7f5fa]" disabled={busy} onClick={onRemove}>Remove QR</Button>
              </div>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="text-xs text-[#dc2626]">{error}</p>}
    </div>
  );
}
