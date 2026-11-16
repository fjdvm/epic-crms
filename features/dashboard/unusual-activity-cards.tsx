"use client";

import { AlertTriangle, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import type { UnusualActivity, UnusualActivityCard } from "./unusual-activity";

const SECTION = "flex min-w-0 flex-col gap-3 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]";
const ENDPOINT = "/api/dashboard/unusual-activity";
const MAX_LINKS = 5;

function Title() {
  return <h2 className="text-[13px] font-medium text-[#71717a]">Unusual activity</h2>;
}

export function UnusualActivitySkeleton() {
  return (
    <section role="status" aria-label="Loading Unusual activity" className={SECTION}>
      <Title />
      {Array.from({ length: 2 }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </section>
  );
}

function Card({ card, canDismiss, onDismiss }: { card: UnusualActivityCard; canDismiss: boolean; onDismiss: () => void }) {
  const numbers = Object.entries(card.numbers);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#b45309]" aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-medium text-[#18181b]">{card.rule}</p>
        {canDismiss && (
          <button type="button" onClick={onDismiss} aria-label={`Dismiss: ${card.rule}`}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#52525b] hover:bg-[#fef3c7]">
            <X className="size-3" aria-hidden /> Dismiss
          </button>
        )}
      </div>
      {(card.explanation?.why || card.explanation?.whatToDo) && (
        <div className="flex flex-col gap-1 text-xs text-[#3f3f46]">
          {card.explanation.why && <p><span className="font-medium">Why:</span> {card.explanation.why}</p>}
          {card.explanation.whatToDo && <p><span className="font-medium">What to do:</span> {card.explanation.whatToDo}</p>}
          <p className="text-[11px] text-[#a1a1aa]">AI suggestion. Nothing has been changed.</p>
        </div>
      )}
      <p className="text-xs text-[#71717a]">{numbers.map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${v}`).join(" · ")}</p>
      <ul className="flex flex-wrap gap-2">
        {card.links.slice(0, MAX_LINKS).map(link => (
          <li key={link.href}>
            <Link href={link.href} prefetch className="text-xs font-medium text-[#5b2a86] underline-offset-2 hover:underline">{link.label}</Link>
          </li>
        ))}
        {card.links.length > MAX_LINKS && <li className="text-xs text-[#71717a]">+{card.links.length - MAX_LINKS} more</li>}
      </ul>
    </li>
  );
}

/**
 * Up to five cards, most urgent first, chosen by the server from the Modules the Staff member holds.
 * Read once when the Dashboard opens and again only on a user action; never on a timer.
 */
export function UnusualActivityCards({ canDismiss, canExplain = canDismiss, initial }: { canDismiss: boolean; canExplain?: boolean; initial?: UnusualActivity }) {
  const [cards, setCards] = useState<UnusualActivityCard[] | null>(initial?.cards ?? null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function explain(key: string) {
    fetch(`${ENDPOINT}/explain`, { method: "POST", headers: { "content-type": "application/json", "x-creoms-alert-explain": "1" }, body: JSON.stringify({ key }) })
      .then(res => res.json())
      .then((body: { explanation?: UnusualActivityCard["explanation"] }) => {
        if (body.explanation) setCards(now => now && now.map(c => c.key === key ? { ...c, explanation: body.explanation! } : c));
      })
      .catch(() => {}); // The card stays as it is without the explanation.
  }

  useEffect(() => {
    if (initial) return;
    let live = true;
    fetch(ENDPOINT, { cache: "no-store" })
      .then(async res => {
        const body = (await res.json()) as UnusualActivity;
        if (!live) return;
        setCards(body.cards ?? []);
        setFailed(!res.ok);
        // Ask for a missing explanation once per card on this open; the server keeps it, so reopening makes no call.
        if (canExplain) for (const card of body.cards ?? []) if (!card.explanation) explain(card.key);
      })
      .catch(() => live && (setCards([]), setFailed(true)));
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  async function dismiss(card: UnusualActivityCard) {
    const before = cards ?? [];
    setError(null);
    setCards(before.filter(c => c.key !== card.key));
    const rollback = (reason: string) => { setCards(before); setError(reason); };
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "x-creoms-alert-dismiss": "1" },
        body: JSON.stringify({ key: card.key, numbers: card.numbers }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string } | null;
      if (!res.ok || !body?.ok) rollback(body?.reason ?? "Could not dismiss this Unusual activity card. Please try again.");
    } catch {
      rollback("Could not dismiss this Unusual activity card. Check your connection and try again.");
    }
  }

  if (cards === null) return <UnusualActivitySkeleton />;
  if (cards.length === 0 && !failed && !error) return null;
  return (
    <section aria-label="Unusual activity" className={SECTION}>
      <Title />
      {error && <p role="alert" className="text-sm text-[#b91c1c]">{error}</p>}
      {failed && cards.length === 0 && <p className="text-sm text-[#71717a]">Couldn&apos;t load</p>}
      <ul className="flex flex-col gap-2">
        {cards.map(card => <Card key={card.key} card={card} canDismiss={canDismiss} onDismiss={() => dismiss(card)} />)}
      </ul>
    </section>
  );
}
