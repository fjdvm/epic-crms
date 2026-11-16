"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/features/customer-profiles/format";
import { loadTicketSummary } from "./summary-client";
import type { SummaryResult } from "./summary-view";

/** One request per Ticket open. Message events, focus and visibility never generate a summary. */
export function SummaryCard({ ticketId }: { ticketId: number }) {
  const [loaded, setLoaded] = useState<{ ticketId: number; value: SummaryResult } | null>(null);
  const result = loaded?.ticketId === ticketId ? loaded.value : null;
  const request = useRef<{ ticketId: number; result: Promise<SummaryResult> } | null>(null);
  useEffect(() => {
    let current = true;
    // Reuse the pending request when React replays the mount effect in development.
    if (!request.current || request.current.ticketId !== ticketId)
      request.current = { ticketId, result: loadTicketSummary(ticketId) };
    request.current.result.then(
      (value) => { if (current) setLoaded({ ticketId, value }); },
      () => { if (current) setLoaded({ ticketId, value: { summary: null, unavailable: true } }); },
    );
    return () => { current = false; };
  }, [ticketId]);

  return (
    <section aria-label="Ticket summary" className="max-h-[45%] shrink-0 space-y-2.5 overflow-y-auto rounded-xl border border-[#e9ddf7] bg-[#f7f3fb] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold text-foreground">Summary</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#ede4f7] px-2 py-0.5 text-xs font-medium text-primary">
          {/* The reference's static icon keeps its native 12 × 12 geometry. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/ai-spark.svg" alt="" /> AI-written
        </span>
      </div>
      {!result ? (
        <div role="status" aria-label="Loading Ticket summary" className="space-y-2">
          <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <>
          {result.unavailable && <p role="status" className="text-[13px] text-muted-foreground">The Ticket summary is unavailable right now. You can keep working by hand.{result.summary ? " Showing the earlier summary below." : ""}</p>}
          {result.summary && <>
            <p className="whitespace-pre-wrap break-words text-[13px] text-[#3f3f46]">{result.summary.text}</p>
            <p className="text-xs text-muted-foreground">Made {formatDate(new Date(result.summary.createdAt))} · Check against the Messages.</p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">What the AI saw</summary>
              <p className="mt-2">Only masked Ticket text. No Internal notes or Linked order details.</p>
              <pre className="mt-2 whitespace-pre-wrap break-words">{result.summary.sentText}</pre>
              <p className="mt-2 font-medium">Instructions sent with the text</p>
              <pre className="mt-2 whitespace-pre-wrap break-words">{result.summary.systemPrompt}</pre>
            </details>
          </>}
        </>
      )}
    </section>
  );
}
