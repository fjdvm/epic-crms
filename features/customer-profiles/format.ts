const pesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const months = new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric", timeZone: "Asia/Manila" });
const dates = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" });
const wholePesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

/** Centavos shown as pesos. */
export function formatPesos(centavos: number): string {
  return pesos.format(centavos / 100);
}

/** Pesos typed by Staff, like "150" or "150.50", as integer centavos; anything else is not an amount. */
export function parsePesos(text: string): number | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;

  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Centavos shown as whole pesos, as the Customer list does. */
export function formatWholePesos(centavos: number): string {
  return wholePesos.format(centavos / 100);
}

/** "12 Oct 2026". */
export function formatDate(date: Date): string {
  return dates.format(date);
}

/** "Mar 2026". */
export function formatMonthYear(date: Date): string {
  return months.format(date);
}

/** How long ago, in the largest whole unit: "Today", "3 days ago", "2 months ago". */
export function formatAgo(date: Date, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));

  if (days < 1) return "Today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }

  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
