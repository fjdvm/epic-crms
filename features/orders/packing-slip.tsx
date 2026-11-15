"use client";

import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatDate } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";

import { loadPackingSlip } from "./actions";

type Slip = Extract<Awaited<ReturnType<typeof loadPackingSlip>>, { ok: true }>["slip"];

/** Only the slip prints: everything else on the page is hidden for the print. */
const PRINT_CSS = `@media print { body * { visibility: hidden !important; } .packing-slip, .packing-slip * { visibility: visible !important; } .packing-slip { position: absolute; inset: 0; padding: 24px; background: #fff; color: #000; } }`;

function Slip({ slip }: { slip: Slip }) {
  const { address } = slip;

  return (
    <div className="packing-slip hidden print:block" aria-label="Packing slip">
      <style>{PRINT_CSS}</style>
      <h1 className="text-xl font-semibold">Packing slip · Order #{slip.id}</h1>
      <p className="text-sm">Placed {formatDate(slip.createdAt)}</p>
      <p className="mt-3 text-sm">Customer: {slip.customer.name}</p>
      <p className="text-sm">
        {orderLabel(slip.fulfillmentMethod)}
        {address && ` · ${address.street}, ${address.barangay}, ${address.city}, ${address.province} ${address.postalCode}, ${address.country}`}
      </p>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b text-left"><th className="py-1">Item</th><th>Size</th><th className="text-right">Qty</th></tr>
        </thead>
        <tbody>
          {slip.lines.map((line, i) => (
            <tr key={i} className="border-b"><td className="py-1">{line.product}</td><td>{line.size}</td><td className="text-right">{line.quantity}</td></tr>
          ))}
        </tbody>
      </table>
      {slip.packedBy && <p className="mt-4 text-sm">Packed by {slip.packedBy.name} · {formatDate(slip.packedBy.at)}</p>}
    </div>
  );
}

/** Reads the slip from the server (no Payment proof), then opens the browser's print dialog. Printing changes nothing, so it needs no approval. */
export function PrintPackingSlip({ id }: { id: number }) {
  const [slip, setSlip] = useState<Slip | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!slip) return;
    const clear = () => setSlip(null);
    window.addEventListener("afterprint", clear, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", clear);
  }, [slip]);

  async function print() {
    setPending(true);
    try {
      const result = await loadPackingSlip(id);
      if (result.ok) setSlip(result.slip);
      else toast.error(result.reason);
    } catch {
      toast.error("The packing slip could not be loaded. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" disabled={pending} onClick={print} className="h-auto rounded-lg px-4 py-[9px] leading-[normal] shadow-none">
        <Printer aria-hidden className="size-4" />
        {pending ? "Preparing slip…" : "Print packing slip"}
      </Button>
      {slip && <Slip slip={slip} />}
    </>
  );
}
