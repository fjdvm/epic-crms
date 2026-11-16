import {
  TICKET_PRIORITIES,
  TICKET_TABS,
  type TicketFilters,
  type TicketPriority,
  type TicketTab,
} from "./tickets";

export interface TicketParams extends TicketFilters {
  tab: TicketTab;
  page: number;
}

type Raw = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

/** The Tickets list's tab, page, search and filters as the address spells them; anything unrecognised is ignored. */
export function parseTicketParams(raw: Raw): TicketParams {
  return {
    tab: TICKET_TABS.find((t) => t === first(raw.tab)) ?? "open",
    page: Math.max(1, Number.parseInt(first(raw.page), 10) || 1),
    q: first(raw.q) || undefined,
    priority: TICKET_PRIORITIES.find((p) => p === first(raw.priority)) as
      TicketPriority | undefined,
    category: first(raw.category) || undefined,
    claimedBy: first(raw.claimed) || undefined,
    overdue: first(raw.overdue) === "1" || undefined,
  };
}

/** True when a search or any filter narrows the list. */
export function hasTicketFilters(params: TicketFilters): boolean {
  return Boolean(
    params.q ||
    params.priority ||
    params.category ||
    params.claimedBy ||
    params.overdue,
  );
}

/** The address of the Tickets list for these params, leaving out whatever is at its default. */
export function ticketsHref(params: TicketParams): string {
  const query = new URLSearchParams();

  if (params.tab !== "open") query.set("tab", params.tab);
  if (params.q) query.set("q", params.q);
  if (params.priority) query.set("priority", params.priority);
  if (params.category) query.set("category", params.category);
  if (params.claimedBy) query.set("claimed", params.claimedBy);
  if (params.overdue) query.set("overdue", "1");
  if (params.page > 1) query.set("page", String(params.page));

  const text = query.toString();

  return text ? `/tickets?${text}` : "/tickets";
}
