"use client";

import { AlertTriangle, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
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

const label = (k: string) => k.replace(/([A-Z])/g, " $1").toLowerCase();

/**
 * Opens from the card with what the card already holds, so it appears at once. Read-only for Admin (no Dismiss).
 * Without an AI explanation the rule, numbers and links still show.
 */
function AlertDrawer({ card, pending, canDismiss, onClose, onDismiss }: {
  card: UnusualActivityCard | null; pending: boolean; canDismiss: boolean; onClose: () => void; onDismiss: (card: UnusualActivityCard) => void;
}) {
  const why = card?.explanation?.why;
  const whatToDo = card?.explanation?.whatToDo;
  return (
    <Sheet open={card !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-[440px] flex-col gap-4 overflow-y-auto bg-white">
        {card && (
          <>
            <div className="flex flex-col gap-1 pr-8">
              <span className="w-fit rounded-full bg-[#fee2e2] px-2 py-0.5 text-[11px] font-medium text-[#b91c1c]">Alert</span>
              <SheetTitle className="text-base">{card.rule}</SheetTitle>
              <SheetDescription>{card.module}</SheetDescription>
            </div>
            <section aria-label="Numbers" className="rounded-xl border border-[#e6e1ee] px-4 py-3">
              <h3 className="mb-2 text-[13px] font-medium text-[#18181b]">The numbers</h3>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(card.numbers).map(([k, v]) => (
                  <div key={k}><dt className="text-xs capitalize text-[#71717a]">{label(k)}</dt><dd className="font-medium text-[#18181b]">{v}</dd></div>
                ))}
              </dl>
            </section>
            <section aria-label="Why" className="rounded-xl border border-[#e6e1ee] px-4 py-3">
              <h3 className="mb-2 text-[13px] font-medium text-[#18181b]">Why (AI-written, check before acting)</h3>
              {why ? <p className="text-sm text-[#3f3f46]">{why}</p>
                : pending ? <Skeleton role="status" aria-label="Loading explanation" className="h-10 w-full" />
                : <p className="text-sm text-[#71717a]">No explanation yet. The rule and numbers above still apply.</p>}
            </section>
            <section aria-label="What to do" className="rounded-xl border border-[#e6e1ee] px-4 py-3">
              <h3 className="mb-2 text-[13px] font-medium text-[#18181b]">What to do (AI-written, check before acting)</h3>
              {whatToDo ? <p className="text-sm text-[#3f3f46]">{whatToDo}</p>
                : pending && !why ? <Skeleton className="h-10 w-full" />
                : <p className="text-sm text-[#71717a]">No suggestion yet. Use the links below.</p>}
              {(why || whatToDo) && <p className="mt-2 text-[11px] text-[#a1a1aa]">AI suggestion. Nothing has been changed.</p>}
              <ul className="mt-3 flex flex-wrap gap-2">
                {card.links.slice(0, MAX_LINKS).map(link => (
                  <li key={link.href}>
                    <Link href={link.href} prefetch className="inline-block rounded-lg bg-[#5b2a86] px-3 py-1.5 text-xs font-medium text-white">{link.label}</Link>
                  </li>
                ))}
              </ul>
            </section>
            {canDismiss && (
              <button type="button" onClick={() => onDismiss(card)} className="w-fit rounded-lg border border-[#e6e1ee] px-3 py-1.5 text-sm font-medium text-[#18181b] hover:bg-[#f4f4f5]">
                Dismiss alert
              </button>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Card({ card, canDismiss, onDismiss, onOpen }: { card: UnusualActivityCard; canDismiss: boolean; onDismiss: () => void; onOpen: () => void }) {
  const numbers = Object.entries(card.numbers);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#b45309]" aria-hidden />
        <button type="button" onClick={onOpen} aria-label={`Open details: ${card.rule}`}
          className="min-w-0 flex-1 text-left text-sm font-medium text-[#18181b] hover:underline">{card.rule}</button>
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
/** `emptyState` shows when there is nothing unusual; without it the section hides. */
export function UnusualActivityCards({ canDismiss, canExplain = canDismiss, initial, emptyState = null }: {
  canDismiss: boolean; canExplain?: boolean; initial?: UnusualActivity; emptyState?: ReactNode;
}) {
  const [cards, setCards] = useState<UnusualActivityCard[] | null>(initial?.cards ?? null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [asking, setAsking] = useState<Set<string>>(new Set());

  function explain(key: string) {
    setAsking(now => new Set(now).add(key));
    fetch(`${ENDPOINT}/explain`, { method: "POST", headers: { "content-type": "application/json", "x-creoms-alert-explain": "1" }, body: JSON.stringify({ key }) })
      .then(res => res.json())
      .then((body: { explanation?: UnusualActivityCard["explanation"] }) => {
        if (body.explanation) setCards(now => now && now.map(c => c.key === key ? { ...c, explanation: body.explanation! } : c));
      })
      .catch(() => {}) // The card stays as it is without the explanation.
      .finally(() => setAsking(now => { const next = new Set(now); next.delete(key); return next; }));
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

  const open = cards?.find(c => c.key === openKey) ?? null;
  if (cards === null) return <UnusualActivitySkeleton />;
  if (cards.length === 0 && !failed && !error) return <>{emptyState}</>;
  return (
    <section aria-label="Unusual activity" className={SECTION}>
      <Title />
      {error && <p role="alert" className="text-sm text-[#b91c1c]">{error}</p>}
      {failed && cards.length === 0 && <p className="text-sm text-[#71717a]">Couldn&apos;t load</p>}
      <ul className="flex flex-col gap-2">
        {cards.map(card => <Card key={card.key} card={card} canDismiss={canDismiss} onDismiss={() => dismiss(card)} onOpen={() => setOpenKey(card.key)} />)}
      </ul>
      <AlertDrawer card={open} pending={open ? asking.has(open.key) : false} canDismiss={canDismiss}
        onClose={() => setOpenKey(null)} onDismiss={c => { setOpenKey(null); void dismiss(c); }} />
    </section>
  );
}
