/** The Dashboard's periods are whole Philippine days: UTC+8, no daylight saving. */
const OFFSET_MS = 8 * 60 * 60 * 1000;

export const PERIOD_PRESETS = ["today", "7-days", "this-month", "last-month", "90-days"] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: "Today",
  "7-days": "7 days",
  "this-month": "This month",
  "last-month": "Last month",
  "90-days": "90 days",
};

/** Half-open: includes `start`, excludes `end`. */
export interface Span {
  start: Date;
  end: Date;
}

export interface Period extends Span {
  /** The period of equal length that ends where this one starts. */
  previous: Span;
}

/** The moment a Philippine calendar date begins; months and days may overflow and roll over. */
function manilaMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - OFFSET_MS);
}

export function resolvePeriod(preset: PeriodPreset, now: Date): Period {
  const manila = new Date(now.getTime() + OFFSET_MS);
  const year = manila.getUTCFullYear();
  const month = manila.getUTCMonth();
  const day = manila.getUTCDate();
  const tomorrow = manilaMidnight(year, month, day + 1);

  let start: Date;
  let end = tomorrow;

  switch (preset) {
    case "today":
      start = manilaMidnight(year, month, day);
      break;
    case "7-days":
      start = manilaMidnight(year, month, day - 6);
      break;
    case "90-days":
      start = manilaMidnight(year, month, day - 89);
      break;
    case "this-month":
      start = manilaMidnight(year, month, 1);
      break;
    case "last-month":
      start = manilaMidnight(year, month - 1, 1);
      end = manilaMidnight(year, month, 1);
      break;
  }

  const length = end.getTime() - start.getTime();

  return { start, end, previous: { start: new Date(start.getTime() - length), end: start } };
}


export interface SalesMonth extends Span {
  /** Philippine calendar month as `YYYY-MM`. */
  label: string;
  /** The current month, which has not finished. */
  soFar: boolean;
}

/** The six Philippine calendar months ending with the one `now` falls in, oldest first. */
export function lastSixMonths(now: Date): SalesMonth[] {
  const manila = new Date(now.getTime() + OFFSET_MS);
  const year = manila.getUTCFullYear();
  const month = manila.getUTCMonth();

  return [5, 4, 3, 2, 1, 0].map((back) => {
    const start = manilaMidnight(year, month - back, 1);
    const end = manilaMidnight(year, month - back + 1, 1);
    const label = new Date(start.getTime() + OFFSET_MS).toISOString().slice(0, 7);

    return { start, end, label, soFar: back === 0 };
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 366;

function manilaDate(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const start = manilaMidnight(year, month, day);
  const back = new Date(start.getTime() + OFFSET_MS);
  return back.getUTCFullYear() === year && back.getUTCMonth() === month && back.getUTCDate() === day ? start : null;
}

/**
 * Whole Philippine days from `from` to `to`, both included, as a half-open span. None when either date is not a real
 * `YYYY-MM-DD` date, `to` is before `from`, or the range is longer than 366 days. Days still to come simply hold no Orders.
 */
export function manilaDays(from: string, to: string): Span | null {
  const start = manilaDate(from);
  const last = manilaDate(to);
  if (!start || !last || last < start) return null;
  const end = new Date(last.getTime() + DAY_MS);
  if ((end.getTime() - start.getTime()) / DAY_MS > MAX_DAYS) return null;
  return { start, end };
}
