"use client";

import { useState } from "react";
import Image from "next/image";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PeriodPreset } from "./period";

export function DashboardExportButton({ period }: { period: PeriodPreset }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/dashboard/pdf?period=${period}`);
      if (!response.ok || !response.headers.get("content-type")?.startsWith("application/pdf")) {
        throw new Error("Dashboard PDF unavailable");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1]
        ?? `dashboard-${period}.pdf`;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        // Give the browser time to start the download before releasing its source.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={download}
        disabled={busy}
        aria-busy={busy}
        className="h-auto shrink-0 gap-[6px] rounded-lg border-[#e4e4e7] bg-white px-[14px] py-[9px] font-medium leading-[normal] text-[#18181b] shadow-none"
      >
        {busy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : (
          <Image src="/images/dashboard-export.svg" alt="" width={16} height={16} />
        )}
        {busy ? "Exporting…" : "Export"}
      </Button>
      {failed && (
        <p role="alert" className="max-w-xs text-sm text-destructive">
          Couldn&apos;t export the Dashboard. Please try again.
        </p>
      )}
    </div>
  );
}
