export interface FeedbackFilters {
  from?: string;
  to?: string;
  stars?: number;
  page: number;
}

export type QuickRange = "7d" | "30d" | "year";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function validDay(value: string): string | undefined {
  if (!DAY.test(value)) return undefined;

  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : undefined;
}

/** The filters in the page address; anything that is not a real date, rating or page is ignored. */
export function parseFilters(raw: Record<string, string | string[] | undefined>): FeedbackFilters {
  let from = validDay(first(raw.from));
  let to = validDay(first(raw.to));
  const stars = Number.parseInt(first(raw.stars), 10);

  if (from && to && from > to) [from, to] = [to, from];

  return {
    from,
    to,
    stars: stars >= 1 && stars <= 5 ? stars : undefined,
    page: Math.max(1, Number.parseInt(first(raw.page), 10) || 1),
  };
}

/** The page address for these filters; the defaults (All time, every rating, page 1) leave no trace. */
export function feedbackHref(filters: FeedbackFilters): string {
  const query = new URLSearchParams();

  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (filters.stars !== undefined) query.set("stars", String(filters.stars));
  if (filters.page > 1) query.set("page", String(filters.page));

  const text = query.toString();

  return text ? `/feedback?${text}` : "/feedback";
}

/** Today's date in the Philippines, "YYYY-MM-DD". */
export function manilaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daysBefore(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** A quick link's range, ending today (included). */
export function quickRange(kind: QuickRange, today: string): { from: string; to: string } {
  if (kind === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };

  return { from: daysBefore(today, kind === "7d" ? 6 : 29), to: today };
}
