"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/features/customer-profiles/format";
import type { ComplaintTheme, ThemeItem, ThemesResult } from "./complaint-themes";
import { loadComplaintThemes } from "./themes-client";

const clock = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Manila" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const LABEL = { ticket: "Ticket", return: "Return", feedback: "Feedback · Order" } as const;

function counts(items: ThemeItem[]) {
  const n = (s: ThemeItem["source"]) => items.filter((i) => i.source === s).length;
  return [n("ticket") && plural(n("ticket"), "ticket"), n("return") && plural(n("return"), "return"), n("feedback") && `${n("feedback")} feedback`]
    .filter(Boolean).join(" · ");
}

function ThemeCard({ theme }: { theme: ComplaintTheme }) {
  return (
    <li className="rounded-xl border border-[#e6e1ee] bg-white p-4">
      <div className="flex items-start gap-3">
        <h3 className="min-w-0 flex-1 text-[15px] font-semibold text-[#1f1a2e]">{theme.label}</h3>
        <span className="shrink-0 rounded-full bg-[#fde8e8] px-2.5 py-0.5 text-xs font-medium text-[#b42318]">{plural(theme.count, "mention")}</span>
      </div>
      <p className="mt-1 text-xs text-[#6e6680]">{counts(theme.items)}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-[#5b2a86]">
        {theme.items.map((item) => (
          <Link key={item.id} href={item.href} className="hover:underline">{LABEL[item.source]} #{item.recordId}</Link>
        ))}
      </div>
    </li>
  );
}

/**
 * Opens once for the period (the server makes the themes only when the period has none) and again only when a Manager
 * presses Refresh. Admin get the kept result and no Refresh button.
 */
export function ComplaintThemesView({ from, to, canRefresh }: { from?: string; to?: string; canRefresh: boolean }) {
  const [state, setState] = useState<{ key: string; value: ThemesResult } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const key = `${from ?? ""}|${to ?? ""}`;
  const started = useRef<{ key: string; result: Promise<ThemesResult> } | null>(null);
  const result = state?.key === key ? state.value : null;

  useEffect(() => {
    let current = true;
    if (!started.current || started.current.key !== key) started.current = { key, result: loadComplaintThemes({ from, to }) };
    started.current.result.then(
      (value) => { if (current) setState({ key, value }); },
      () => { if (current) setState({ key, value: { themes: null, unavailable: true } }); },
    );
    return () => { current = false; };
  }, [key, from, to]);

  const refresh = async () => {
    setRefreshing(true);
    const value = await loadComplaintThemes({ from, to }, true).catch((): ThemesResult => ({ themes: null, unavailable: true }));
    // A failed refresh keeps what was on screen; the server also keeps the older result.
    setState((old) => ({ key, value: value.themes ? value : { themes: value.themes ?? old?.value.themes ?? null, unavailable: true } }));
    setRefreshing(false);
  };

  const themes = result?.themes ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex shrink-0 items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-[#6e6680]">
          {themes
            ? `Last made ${clock.format(new Date(themes.createdAt))} from ${plural(themes.ticketsRead, "ticket")}, ${plural(themes.returnsRead, "return")} and ${themes.feedbackRead} feedback.`
            : result ? "" : "Making Complaint themes for this period…"}
        </p>
        {canRefresh && (
          <button type="button" onClick={refresh} disabled={refreshing || !result}
            className="shrink-0 cursor-pointer rounded-lg border border-[#e6e1ee] bg-white px-3.5 py-2 text-sm font-medium text-[#1f1a2e] disabled:cursor-not-allowed disabled:opacity-50">
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>
      {!result || refreshing ? (
        <div role="status" aria-label="Loading Complaint themes" className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : (
        <>
          {result.unavailable && (
            <p role="alert" className="text-[13px] text-[#b45309]">
              {themes ? "Complaint themes could not be refreshed right now. Showing the earlier result."
                : canRefresh ? "Complaint themes are unavailable right now. You can keep working by hand."
                : "No Complaint themes have been made for this period yet."}
            </p>
          )}
          {themes && themes.themes.length === 0 && <p className="text-sm text-[#6e6680]">No repeated complaints in this period</p>}
          {themes && themes.truncated && <p className="text-xs text-[#6e6680]">Read the newest {themes.ticketsRead + themes.returnsRead + themes.feedbackRead} of {themes.itemsAvailable} items.</p>}
          {themes && themes.themes.length > 0 && <ul className="space-y-3">{themes.themes.map((t) => <ThemeCard key={t.label} theme={t} />)}</ul>}
          {themes && (
            <details className="text-xs text-[#6e6680]">
              <summary className="cursor-pointer">What the AI saw{themes.model ? ` (${themes.model})` : ""}</summary>
              <p className="mt-2">Only masked text, cut short. No Internal notes, names or addresses. Made {formatDate(new Date(themes.createdAt))}.</p>
              <pre className="mt-2 whitespace-pre-wrap break-words">{themes.sentText || "Nothing was sent."}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
