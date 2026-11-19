"use client";

import { ArrowDown, ArrowRight, ArrowUp, Sparkles } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

import type { ProductAdviceResponse, RankedProduct } from "./product-advice";

/** `null` while the suggestions are being made or read. */
export type AdviceState = ProductAdviceResponse | null;

const TREND = {
  up: { icon: ArrowUp, label: "Rating up on the previous 30 days", tone: "text-[#15803d]" },
  down: { icon: ArrowDown, label: "Rating down on the previous 30 days", tone: "text-[#b91c1c]" },
  flat: { icon: ArrowRight, label: "Rating steady on the previous 30 days", tone: "text-[#6e6680]" },
} as const;

function ProductCard({ p }: { p: RankedProduct }) {
  const trend = p.trend ? TREND[p.trend] : null;

  return (
    <li className="rounded-xl border border-[#e6e1ee] bg-white p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#f1edf6] text-xs font-semibold text-[#5b2a86]">{p.rank}</span>
        <h3 className="min-w-0 flex-1 text-[15px] font-semibold text-[#1f1a2e]">{p.product}</h3>
        {trend && <trend.icon role="img" aria-label={trend.label} className={`size-4 shrink-0 ${trend.tone}`} />}
      </div>
      <p className="mt-1 text-xs text-[#6e6680]">
        {p.feedbackCount} Feedbacks · {p.averageRating.toFixed(1)} stars · {Math.round(p.negativeShare * 100)}% negative
      </p>
      {p.advice && (
        <div className="mt-3 space-y-1 rounded-lg bg-[#f7f5fa] p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-[#1f1a2e]">
            <Sparkles aria-hidden className="size-3.5 text-[#5b2a86]" />
            {p.advice.label}
          </p>
          <p className="text-sm text-[#52525b]">{p.advice.why}</p>
          <p className="text-[11px] text-[#6e6680]">AI-written · advice only, nothing changes until a person acts</p>
        </div>
      )}
    </li>
  );
}

/** The Analyze drawer: products ranked worst first, each with the AI's suggested action. The order is from the numbers, not the model. */
export function ProductAdviceDrawer({ open, onOpenChange, state }: { open: boolean; onOpenChange: (open: boolean) => void; state: AdviceState }) {
  const result = state?.result ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[480px] flex-col gap-4 bg-white">
        <div className="flex flex-col gap-1">
          <SheetTitle className="text-lg font-semibold text-[#1f1a2e]">Product suggestions</SheetTitle>
          <SheetDescription className="text-sm text-[#6e6680]">Products ranked by what needs attention first, from their Feedback.</SheetDescription>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {state === null && (
            <div role="status" aria-label="Loading suggestions" className="space-y-3">
              {[0, 1, 2].map((n) => <Skeleton key={n} className="h-28 w-full rounded-xl" />)}
            </div>
          )}
          {state !== null && result === null && (
            <p role={state.unavailable ? "alert" : undefined} className="text-sm text-[#6e6680]">
              {state.refused ? "Your Role cannot open these suggestions." : state.unavailable ? "Suggestions are unavailable right now. Try again in a moment." : "No suggestions yet. Press Analyze to make them."}
            </p>
          )}
          {result && result.products.length === 0 && (
            <p className="text-sm text-[#6e6680]">No product has enough Feedback yet. A product needs at least 5 Feedbacks to be ranked.</p>
          )}
          {result && result.adviceUnavailable && result.products.length > 0 && (
            <p role="alert" className="rounded-lg bg-[#fdf1d8] px-3 py-2 text-[13px] text-[#8a5a00]">Suggestions are unavailable right now. The ranking is still shown.</p>
          )}
          {result && result.products.length > 0 && (
            <ol className="flex flex-col gap-3">{result.products.map((p) => <ProductCard key={p.product} p={p} />)}</ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
