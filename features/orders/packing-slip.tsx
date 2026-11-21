"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

const FAILED = "The packing slip could not be loaded. Try again in a moment.";

/**
 * Opens the packing slip as a PDF in a new tab, where the browser's viewer prints it. The tab opens inside
 * the click so a popup blocker allows it, then shows the PDF once the server has made it. Printing changes
 * nothing, so it needs no approval.
 */
export function PrintPackingSlip({ id }: { id: number }) {
  const [pending, setPending] = useState(false);

  async function print() {
    setPending(true);
    const tab = window.open("", "_blank");
    try {
      const response = await fetch(`/api/orders/${id}/packing-slip`);
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { reason?: string } | null;
        throw new Error(body?.reason ?? FAILED);
      }
      const url = URL.createObjectURL(await response.blob());
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      tab?.close();
      toast.error(error instanceof Error && error.message ? error.message : FAILED);
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" variant="outline" disabled={pending} onClick={print} className="h-auto rounded-lg px-4 py-[9px] leading-[normal] shadow-none">
      <Printer aria-hidden className="size-4" />
      {pending ? "Preparing slip…" : "Print packing slip"}
    </Button>
  );
}
