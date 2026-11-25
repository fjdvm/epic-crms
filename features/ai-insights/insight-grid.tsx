"use client";

import {
  ArrowRight, CreditCard, LayoutDashboard, LifeBuoy, Package, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, Truck, X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

import {
  CATEGORY_LABELS, CONFIDENCE_LABELS, PRIORITY_LABELS, type Category, type Confidence, type Insight, type PeriodDays, type Priority,
} from "./insights";
import type { EvidenceRecord } from "./store";

const ENDPOINT = "/api/dashboard/ai-insights";
const TABS: ("all" | Category)[] = ["all", "stock", "payments", "support", "returns", "delivery"];
const ICONS: Record<Category, typeof Package> = { stock: Package, payments: CreditCard, support: LifeBuoy, returns: RotateCcw, delivery: Truck };
const PRIORITY_STYLE: Record<Priority, string> = {
  high: "bg-[#fef2f2] text-[#b91c1c]", watch: "bg-[#fffbeb] text-[#b45309]", info: "bg-[#f4f4f5] text-[#52525b]",
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return <span className="shrink-0 rounded-full border border-[#e6dcf2] bg-white px-2 py-0.5 text-[11px] font-medium text-[#5b2a86]">{CONFIDENCE_LABELS[confidence]}</span>;
}
function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_STYLE[priority]}`}>{PRIORITY_LABELS[priority]}</span>;
}

async function send(payload: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "x-creoms-ai-insight": "1" }, body: JSON.stringify(payload) });
  } catch {
    throw new Error("Couldn't reach CREOMS. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string } | null;
  if (!res.ok || !body?.ok) throw new Error(body?.reason ?? "Could not save that. Please try again.");
}

/**
 * "Insights to look at". Buttons only open screens or the Evidence drawer; nothing here changes the shop.
 * Dismiss and Helpful / Not helpful are personal, optimistic, and rolled back with the reason if refused.
 */
export function InsightGrid({ initial, days, answers: initialAnswers, enoughData, waiting }: {
  initial: Insight[]; days: PeriodDays; answers: Record<string, boolean>; enoughData: boolean; waiting?: boolean;
}) {
  const [cards, setCards] = useState(initial);
  const [tab, setTab] = useState<(typeof TABS)[number]>("all");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Insight | null>(null);
  const [answers, setAnswers] = useState(initialAnswers);

  const count = (t: (typeof TABS)[number]) => (t === "all" ? cards.length : cards.filter((c) => c.category === t).length);
  const shown = tab === "all" ? cards : cards.filter((c) => c.category === tab);

  async function dismiss(card: Insight) {
    const before = cards;
    setError(null);
    setCards(before.filter((c) => c.key !== card.key));
    if (open?.key === card.key) setOpen(null);
    try {
      await send({ action: "dismiss", days, key: card.key });
    } catch (e) {
      setCards(before);
      setError(`Couldn't dismiss "${card.headline}". ${(e as Error).message}`);
    }
  }

  async function answer(card: Insight, helpful: boolean) {
    const before = answers;
    setError(null);
    setAnswers({ ...before, [card.key]: helpful });
    try {
      await send({ action: "feedback", days, key: card.key, helpful });
    } catch (e) {
      setAnswers(before);
      setError(`Couldn't save your answer. ${(e as Error).message}`);
    }
  }

  return (
    <section aria-label="Insights to look at" className="flex min-w-0 flex-col gap-3 leading-[normal]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-[17px] font-semibold text-[#18181b]">Insights to look at</h2>
        {!enoughData && <span className="text-xs text-[#71717a]">{waiting ? "Waiting for the first morning run" : "Waiting for more orders"}</span>}
      </div>

      {!enoughData ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-[#e6e1ee] bg-white px-6 py-10 text-center">
          <Sparkles className="size-5 text-[#5b2a86]" aria-hidden />
          <p className="text-[15px] font-semibold text-[#18181b]">No insights yet</p>
          <p className="max-w-[28rem] text-sm text-[#71717a]">
            {waiting
              ? "Insights are worked out each morning at 6:00 am. Until the first run, the Dashboard shows what needs attention today."
              : "Insights start once there are at least 30 orders in the period. Until then, the Dashboard shows what needs attention today."}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link href="/dashboard" prefetch className="flex items-center gap-1.5 rounded-lg bg-[#5b2a86] px-3 py-2 text-sm font-medium text-white">
              <LayoutDashboard className="size-4" aria-hidden /> Open Dashboard
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Insight categories" className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => setTab(t)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#52525b] hover:bg-[#f5f0fa] aria-selected:bg-[#efe7f7] aria-selected:text-[#5b2a86]">
                {t === "all" ? "All" : CATEGORY_LABELS[t]} <span className="ml-0.5 text-[#a1a1aa]">{count(t)}</span>
              </button>
            ))}
          </div>
          {error && <p role="alert" className="text-sm text-[#b91c1c]">{error}</p>}
          {shown.length === 0 ? (
            <p className="rounded-2xl border border-[#e6e1ee] bg-white px-5 py-6 text-sm text-[#71717a]">
              {cards.length === 0 ? "Nothing needs a look right now." : "Nothing in this category right now."}
            </p>
          ) : (
            <ul className="grid auto-rows-fr grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
              {shown.map((card) => <InsightCard key={card.key} card={card} onEvidence={() => setOpen(card)} onDismiss={() => dismiss(card)} />)}
            </ul>
          )}
        </>
      )}

      <EvidenceDrawer insight={open} days={days} answer={open ? answers[open.key] : undefined} error={error}
        onClose={() => setOpen(null)} onAnswer={(helpful) => open && answer(open, helpful)} onDismiss={() => open && dismiss(open)} />
    </section>
  );
}

function InsightCard({ card, onEvidence, onDismiss }: { card: Insight; onEvidence: () => void; onDismiss: () => void }) {
  const Icon = ICONS[card.category];
  return (
    <li className="flex h-full min-w-0 flex-col gap-3 rounded-2xl border border-[#e6e1ee] bg-white px-4 py-4" data-insight={card.key}>
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#f5f0fa] text-[#5b2a86]"><Icon className="size-4" aria-hidden /></span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-[#18181b]">{card.headline}</h3>
        <PriorityBadge priority={card.priority} />
      </div>
      <p className="text-xs text-[#52525b]"><span className="font-medium text-[#18181b]">Based on:</span> {card.basedOn}</p>
      <div className="flex flex-1 flex-col gap-1.5 rounded-xl bg-[#f8f5fc] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-[#5b2a86]" aria-hidden />
          <span className="min-w-0 flex-1 text-xs font-semibold text-[#5b2a86]">Why and what to do</span>
          <ConfidenceBadge confidence={card.confidence} />
        </div>
        <p className="text-xs text-[#3f3f46]">{card.ai ?? card.nextStep}</p>
        <p className="text-[11px] text-[#a1a1aa]">{card.ai ? "AI-written from the figures above. Check before acting." : "The rule's suggested next step."}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onEvidence} className="rounded-lg border border-[#e4e4e7] bg-white px-2.5 py-1.5 text-xs font-medium text-[#18181b] hover:bg-[#fafafa]">
          See evidence
        </button>
        <Link href={card.action.href} prefetch className="flex items-center gap-1 rounded-lg bg-[#5b2a86] px-2.5 py-1.5 text-xs font-medium text-white">
          <ArrowRight className="size-3" aria-hidden /> {card.action.label}
        </Link>
        <button type="button" onClick={onDismiss} aria-label={`Dismiss for me: ${card.headline}`}
          className="ml-auto rounded-lg px-2 py-1.5 text-xs font-medium text-[#71717a] hover:bg-[#f4f4f5]">
          Dismiss for me
        </button>
      </div>
    </li>
  );
}

type Records = { state: "loading" } | { state: "ready"; records: EvidenceRecord[] } | { state: "failed"; reason: string };
type Loaded = Exclude<Records, { state: "loading" }> & { key: string };

/** "See evidence": how the rule got there, the records behind it (read now, linked), and the suggested next step. */
function EvidenceDrawer({ insight, days, answer, error, onClose, onAnswer, onDismiss }: {
  insight: Insight | null; days: PeriodDays; answer: boolean | undefined; error: string | null;
  onClose: () => void; onAnswer: (helpful: boolean) => void; onDismiss: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = insight?.key;
  // Until this card's records arrive, the drawer shows the loading state at once.
  const records: Records = loaded && loaded.key === key ? loaded : { state: "loading" };

  useEffect(() => {
    if (!key) return;
    let live = true;
    fetch(`${ENDPOINT}/evidence?days=${days}&key=${encodeURIComponent(key)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { ok?: boolean; records?: EvidenceRecord[]; reason?: string } | null;
        if (!live) return;
        setLoaded(res.ok && body?.ok ? { key, state: "ready", records: body.records ?? [] } : { key, state: "failed", reason: body?.reason ?? "Couldn't load the records." });
      })
      .catch(() => { if (live) setLoaded({ key, state: "failed", reason: "Couldn't load the records. Check your connection and try again." }); });
    return () => { live = false; };
  }, [key, days]);

  return (
    <Sheet open={!!insight} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[28rem]">
        {insight && (
          <>
            <div className="flex flex-col gap-2 border-b border-[#f0edf4] px-5 pb-4 pt-5 pr-12">
              <p className="text-xs font-medium text-[#71717a]">Evidence</p>
              <SheetTitle className="text-base font-semibold leading-snug text-[#18181b]">{insight.headline}</SheetTitle>
              <SheetDescription className="sr-only">How this insight was worked out and the records behind it.</SheetDescription>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full bg-[#f4f4f5] px-2 py-0.5 text-[11px] font-medium text-[#52525b]">{CATEGORY_LABELS[insight.category]}</span>
                <PriorityBadge priority={insight.priority} />
                <ConfidenceBadge confidence={insight.confidence} />
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4 text-sm">
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold text-[#18181b]">How the AI got here</h3>
                <ol className="flex flex-col gap-1.5">
                  {insight.steps.map((step, i) => (
                    <li key={i} className="flex gap-2 text-xs text-[#3f3f46]">
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#efe7f7] text-[10px] font-semibold text-[#5b2a86]">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <p className="text-[11px] italic text-[#71717a]">{insight.confidenceReason}</p>
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold text-[#18181b]">
                  {records.state === "ready" ? `The ${records.records.length} ${records.records.length === 1 ? "record" : "records"}` : "The records"}
                  <span className="ml-1 font-normal text-[#a1a1aa]">· tap one to open it</span>
                </h3>
                {records.state === "loading" && (
                  <div role="status" aria-label="Loading the records" className="flex flex-col gap-1.5">
                    {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                )}
                {records.state === "failed" && <p role="alert" className="text-xs text-[#b91c1c]">{records.reason}</p>}
                {records.state === "ready" && (records.records.length === 0
                  ? <p className="text-xs text-[#71717a]">These records are no longer available.</p>
                  : (
                    <ul className="flex flex-col divide-y divide-[#f0edf4] rounded-xl border border-[#ece8f1]">
                      {records.records.map((r) => (
                        <li key={`${r.type}:${r.id}`}>
                          <Link href={r.href} prefetch={false} className="flex items-center gap-2 px-3 py-2 hover:bg-[#faf8fc]">
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-semibold text-[#5b2a86]">{r.label}</span>
                              <span className="block truncate text-[11px] text-[#71717a]">{r.detail}</span>
                            </span>
                            <span className="shrink-0 rounded-full bg-[#f4f4f5] px-2 py-0.5 text-[11px] text-[#52525b]">{r.status}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ))}
              </div>

              <div className="flex flex-col gap-2 rounded-xl bg-[#f8f5fc] px-3 py-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3.5 text-[#5b2a86]" aria-hidden />
                  <span className="min-w-0 flex-1 text-xs font-semibold text-[#5b2a86]">Suggested next step</span>
                  <ConfidenceBadge confidence={insight.confidence} />
                </div>
                <p className="text-xs text-[#3f3f46]">{insight.ai ?? insight.nextStep}</p>
                {insight.ai && <p className="text-xs text-[#3f3f46]">{insight.nextStep}</p>}
                <p className="text-[11px] text-[#a1a1aa]">The AI only suggests. A person opens the screen and decides.</p>
                <Link href={insight.action.href} prefetch className="flex w-fit items-center gap-1 rounded-lg bg-[#5b2a86] px-2.5 py-1.5 text-xs font-medium text-white">
                  <ArrowRight className="size-3" aria-hidden /> {insight.action.label}
                </Link>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-[#f0edf4] px-5 py-3 text-xs">
              {error && <p role="alert" className="w-full text-[#b91c1c]">{error}</p>}
              <span className="text-[#71717a]">Was this useful?</span>
              <button type="button" aria-pressed={answer === true} onClick={() => onAnswer(true)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-[#52525b] hover:bg-[#f4f4f5] aria-pressed:bg-[#efe7f7] aria-pressed:text-[#5b2a86]">
                <ThumbsUp className="size-3.5" aria-hidden /> Helpful
              </button>
              <button type="button" aria-pressed={answer === false} onClick={() => onAnswer(false)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-[#52525b] hover:bg-[#f4f4f5] aria-pressed:bg-[#efe7f7] aria-pressed:text-[#5b2a86]">
                <ThumbsDown className="size-3.5" aria-hidden /> Not helpful
              </button>
              <button type="button" onClick={onDismiss} className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-[#71717a] hover:bg-[#f4f4f5]">
                <X className="size-3.5" aria-hidden /> Dismiss for me
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function InsightGridSkeleton() {
  return (
    <section aria-label="Insights to look at" aria-busy="true" className="flex flex-col gap-3">
      <h2 className="text-[17px] font-semibold text-[#18181b]">Insights to look at</h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-52 w-full rounded-2xl" />)}
      </div>
    </section>
  );
}
