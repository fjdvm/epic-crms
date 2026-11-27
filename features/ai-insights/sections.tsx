"use client";

import { ChevronDown, Info, Sparkles } from "lucide-react";
import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { ConfidenceBadge } from "./insight-grid";
import type { Confidence, Stats } from "./insights";

/** "This week in brief": the AI's 2–3 sentences from the run, or why there are none. Never asks a model. */
export function Brief({ days, summary, confidence, enoughData, orders, stats, waiting }: {
  days: 7 | 30; summary: string | null; confidence: Confidence | null; enoughData: boolean; orders: number; stats: Stats; waiting?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const title = days === 7 ? "This week in brief" : "These 30 days in brief";
  const text = waiting
    ? "The first insights are worked out at 6:00 am. Until then there is nothing to summarise."
    : !enoughData
      ? `There are not enough orders yet to find real patterns: ${orders} in the last ${days} days. I need at least 30 before I can say anything useful. Until then I would only be guessing.`
      : summary ?? "The AI summary was not available this morning. The figures and insights below are still current.";
  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-2xl border border-[#e6dcf2] bg-[#f8f5fc] px-5 py-4 leading-[normal]">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-[#5b2a86]" aria-hidden />
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-[#5b2a86]">{title}</h2>
        {enoughData && summary && confidence ? <ConfidenceBadge confidence={confidence} />
          : <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#5b2a86]">{waiting ? "Not run yet" : enoughData ? "AI unavailable" : "Not enough data"}</span>}
      </div>
      <p className="text-sm text-[#3f3f46]">{text}</p>
      {enoughData && (
        <>
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
            className="flex w-fit items-center gap-1 rounded-lg border border-[#e6dcf2] bg-white px-2.5 py-1 text-xs font-medium text-[#5b2a86]">
            See what this is based on <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {open && (
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-[#52525b] sm:grid-cols-2">
              {STAT_ORDER.map(([key, label]) => (
                <li key={key}><span className="font-medium text-[#18181b]">{label}:</span> {stats[key].value ?? "—"} · {stats[key].note}</li>
              ))}
              <li className="sm:col-span-2 text-[11px] text-[#a1a1aa]">Worked out in code from orders, payments, tickets, returns and stock. The AI only wrote the sentences, and any number it quoted had to be one of these.</li>
            </ul>
          )}
        </>
      )}
    </section>
  );
}

const STAT_ORDER: [keyof Stats, string][] = [
  ["orders", "Orders"], ["lateOrFailed", "Late or failed"], ["returns", "Returns & damage"], ["openTickets", "Open tickets"], ["stockWatch", "Stock watch"],
  ["rating", "Average rating"],
];
const TONE = { up: "text-[#15803d]", down: "text-[#b91c1c]", warn: "text-[#b45309]" } as const;

export function StatRow({ stats }: { stats: Stats }) {
  return (
    <ul aria-label="This period in numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {STAT_ORDER.map(([key, label]) => {
        const stat = stats[key];
        return (
          <li key={key} className="flex min-w-0 flex-col gap-1 rounded-2xl border border-[#e6e1ee] bg-white px-4 py-3 leading-[normal]">
            <span className="text-xs text-[#71717a]">{label}</span>
            <span className="text-2xl font-semibold tabular-nums text-[#18181b]">{stat.value === null ? "—" : key === "rating" ? `${stat.value.toFixed(1)} ★` : stat.value.toLocaleString("en-PH")}</span>
            <span className={`truncate text-xs ${stat.tone ? TONE[stat.tone] : "text-[#71717a]"}`} title={stat.note}>{stat.note}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function StatRowSkeleton() {
  return (
    <div aria-busy="true" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[86px] rounded-2xl" />)}
    </div>
  );
}

export function HowThisWorks() {
  return (
    <aside aria-label="How this works" className="flex gap-2 rounded-2xl border border-[#e6dcf2] bg-[#f8f5fc] px-4 py-3 text-xs leading-[normal] text-[#52525b]">
      <Info className="mt-0.5 size-4 shrink-0 text-[#5b2a86]" aria-hidden />
      <p>
        <span className="font-semibold text-[#18181b]">How this works. </span>
        Each morning at 6:00 am the figures are worked out in code from orders, payments, tickets, returns and stock, and kept
        for the day. The AI only writes the short explanations from those figures. It never changes an order, stock, payment,
        ticket or customer: a person opens the screen and decides. Dismissing a card hides it for you only, until its numbers get worse.
      </p>
    </aside>
  );
}
