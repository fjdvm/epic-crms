"use client";

import { Lightbulb, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import type { Suggestion } from "./suggestions";

const SECTION = "flex min-w-0 flex-col gap-3 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]";
const ENDPOINT = "/api/dashboard/ai-insights";

function Title() {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-[13px] font-medium text-[#71717a]">Suggestions</h2>
      <p className="text-xs text-[#a1a1aa]">From the last 30 days, worked out by fixed rules. Nothing changes until a person acts.</p>
    </div>
  );
}

export function SuggestionsSkeleton() {
  return (
    <section role="status" aria-label="Loading suggestions" className={SECTION}>
      <Title />
      {Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </section>
  );
}

export function SuggestionsUnavailable() {
  return (
    <section aria-label="Suggestions" className={SECTION}>
      <Title />
      <p className="text-sm text-[#71717a]">Couldn&apos;t load suggestions. Reload the page to try again.</p>
    </section>
  );
}

/**
 * Manager-level people accept (logged with their name, then the screen opens) or dismiss a suggestion.
 * Admin views only, with plain links. The "why" is AI-written once per suggestion and kept; Admin never cause a model call.
 */
export function SuggestionCards({ initial, canDecide }: { initial: Suggestion[]; canDecide: boolean }) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [asking, setAsking] = useState<Set<string>>(() => new Set(canDecide ? initial.filter((c) => !c.why).map((c) => c.key) : []));

  useEffect(() => {
    if (!canDecide) return;
    // Ask once per card on this open for a missing "why"; the server keeps it, so reopening makes no model call.
    for (const card of initial) {
      if (card.why) continue;
      fetch(`${ENDPOINT}/explain`, { method: "POST", headers: { "content-type": "application/json", "x-creoms-ai-insight-explain": "1" }, body: JSON.stringify({ key: card.key }) })
        .then((res) => res.json())
        .then((body: { why?: string | null }) => { if (body.why) setCards((now) => now.map((c) => (c.key === card.key ? { ...c, why: body.why } : c))); })
        .catch(() => {}) // The card stays as it is without the sentence.
        .finally(() => setAsking((now) => { const next = new Set(now); next.delete(card.key); return next; }));
    }
  }, [initial, canDecide]);

  async function send(card: Suggestion, decision: "accepted" | "dismissed") {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-creoms-ai-insight": "1" },
      body: JSON.stringify({ key: card.key, numbers: card.numbers, decision }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string; href?: string } | null;
    if (!res.ok || !body?.ok) throw new Error(body?.reason ?? "Could not save that. Please try again.");
    return body;
  }

  async function dismiss(card: Suggestion) {
    const before = cards;
    setError(null);
    setCards(before.filter((c) => c.key !== card.key));
    try {
      await send(card, "dismissed");
    } catch (e) {
      setCards(before);
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Could not dismiss this suggestion. Check your connection and try again.");
    }
  }

  async function accept(card: Suggestion) {
    setError(null);
    setAccepting(card.key);
    try {
      const body = await send(card, "accepted");
      setCards((now) => now.filter((c) => c.key !== card.key));
      router.push(body.href ?? card.action.href);
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Could not save that. Check your connection and try again.");
    } finally {
      setAccepting(null);
    }
  }

  if (cards.length === 0 && !error) {
    return (
      <section aria-label="Suggestions" className={SECTION}>
        <Title />
        <p className="text-sm text-[#71717a]">No suggestions right now.</p>
      </section>
    );
  }
  return (
    <section aria-label="Suggestions" className={SECTION}>
      <Title />
      {error && <p role="alert" className="text-sm text-[#b91c1c]">{error}</p>}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2">
        {cards.map((card) => {
          const showAction = canDecide || !card.action.managerOnly;
          return (
            <li key={card.key} className="flex flex-col gap-2 rounded-xl border border-[#e6e1ee] bg-[#faf8fc] px-4 py-3">
              <div className="flex items-start gap-2">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-[#5b2a86]" aria-hidden />
                <p className="min-w-0 flex-1 text-sm font-medium text-[#18181b]">{card.text}</p>
                {canDecide && (
                  <button type="button" onClick={() => dismiss(card)} aria-label={`Dismiss: ${card.text}`}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#52525b] hover:bg-[#f1edf6]">
                    <X className="size-3" aria-hidden /> Dismiss
                  </button>
                )}
              </div>
              {card.why ? (
                <p className="text-xs text-[#3f3f46]"><span className="font-medium">Why it matters (AI-written, check before acting):</span> {card.why}</p>
              ) : asking.has(card.key) ? <Skeleton role="status" aria-label="Loading why it matters" className="h-4 w-3/4" /> : null}
              {showAction && (
                canDecide ? (
                  <button type="button" disabled={accepting !== null} onClick={() => accept(card)}
                    className="flex w-fit items-center gap-1.5 rounded-lg bg-[#5b2a86] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-70">
                    {accepting === card.key && <Loader2 className="size-3 animate-spin" aria-hidden />}
                    {card.action.label}
                  </button>
                ) : (
                  <Link href={card.action.href} prefetch className="w-fit text-xs font-medium text-[#5b2a86] hover:underline">{card.action.label}</Link>
                )
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
