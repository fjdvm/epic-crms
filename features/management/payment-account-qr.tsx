"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { uploadFile } from "@/features/files/client";
import { Button } from "@/components/ui/button";

import { changePaymentAccountQr } from "./payment-actions";

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
      {hasQr && (
        // eslint-disable-next-line @next/next/no-img-element -- the route redirects to a short-lived signed address
        <img src={`/api/payment-accounts/${accountId}/qr`} alt={`QR for ${label}`} className="size-24 rounded-md border border-[#e6e1ee] object-contain" />
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png" className="sr-only" aria-label={`QR image for ${label}`} onChange={onPick} />
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" className="h-auto rounded-lg border border-[#e6e1ee] bg-transparent px-4 py-[9px] leading-[normal] text-[#1f1a2e] shadow-none hover:bg-[#f7f5fa]" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Saving…" : hasQr ? "Replace QR" : "Add QR"}
        </Button>
        {hasQr && <Button type="button" variant="outline" className="h-auto rounded-lg border border-[#e6e1ee] bg-transparent px-4 py-[9px] leading-[normal] text-[#1f1a2e] shadow-none hover:bg-[#f7f5fa]" disabled={busy} onClick={onRemove}>Remove QR</Button>}
      </div>
      {error && <p role="alert" className="text-xs text-[#dc2626]">{error}</p>}
    </div>
  );
}
