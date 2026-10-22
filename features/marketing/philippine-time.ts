/** Staff schedule in Philippine Time (UTC+8, no daylight saving), whatever zone their browser is in. */
const ZONE = "Asia/Manila";

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const shown = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "2026-10-25T09:30", the value a datetime-local input holds, for this moment in Philippine Time. */
export function toPhilippineInput(date: Date): string {
  const p = Object.fromEntries(parts.formatToParts(date).map((x) => [x.type, x.value]));

  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The moment a datetime-local value names in Philippine Time; null when it is not a real date and time. */
export function parsePhilippineTime(local: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;

  const date = new Date(`${local}:00+08:00`);

  // Dates that roll over, such as 31 February, read back as a different value.
  return Number.isNaN(date.getTime()) || toPhilippineInput(date) !== local ? null : date;
}

/** "25 Oct 2026, 9:30 am". Add the zone name where it is not already obvious. */
export function formatPhilippineTime(date: Date): string {
  return shown.format(date).replace(/\b(am|pm)\b/i, (m) => m.toLowerCase());
}
