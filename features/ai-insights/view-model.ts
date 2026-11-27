import { FEEDBACK_MODULE, FULFILMENT_MODULE, ORDERS_MODULE, RETURNS_MODULE, TICKETS_MODULE } from "@/lib/portal/config";

import type { Category, Stats } from "./insights";

/**
 * The category tabs of "Insights to look at". Here, not in the client grid, because the server page reads `?category=`
 * with `tabFor`, and a server component cannot call a function exported from a "use client" file.
 */
export const TABS: ("all" | Category)[] = ["all", "stock", "payments", "support", "returns", "delivery", "feedback"];
export type Tab = (typeof TABS)[number];

/** The tab a `?category=` link opens; anything else opens All. */
export function tabFor(category: string | undefined): Tab {
  return TABS.find((t) => t === category) ?? "all";
}

/** Which Module each stat tile needs; a tile from a Module the person does not hold shows a dash. */
export const STAT_MODULES: Record<keyof Stats, string> = {
  orders: ORDERS_MODULE, lateOrFailed: FULFILMENT_MODULE, returns: RETURNS_MODULE, openTickets: TICKETS_MODULE, stockWatch: ORDERS_MODULE, rating: FEEDBACK_MODULE,
};

export function visibleStats(stats: Stats, modules: readonly string[]): Stats {
  const out = { ...stats };
  for (const key of Object.keys(STAT_MODULES) as (keyof Stats)[])
    if (!modules.includes(STAT_MODULES[key])) out[key] = { value: null, note: "Not in your Modules" };
  return out;
}

const OFFSET = 8 * 60 * 60 * 1000;
const time = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true });
const date = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" });

/** "Updated today, 6:00 am", "Updated yesterday, 6:04 am" or "Updated 21 Nov, 6:00 am", in Philippine time. */
export function updatedLabel(createdAt: string, now: Date): string {
  const at = new Date(createdAt);
  const day = (d: Date) => Math.floor((d.getTime() + OFFSET) / 86_400_000);
  const gap = day(now) - day(at);
  const when = gap === 0 ? "today" : gap === 1 ? "yesterday" : date.format(at);
  return `Updated ${when}, ${time.format(at).replace(/\s?([AP])M$/i, (_, m: string) => ` ${m.toLowerCase()}m`)}`;
}
