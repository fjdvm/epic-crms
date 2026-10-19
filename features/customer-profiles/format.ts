const pesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const months = new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric", timeZone: "Asia/Manila" });
const dates = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" });

/** Centavos shown as pesos. */
export function formatPesos(centavos: number): string {
  return pesos.format(centavos / 100);
}

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
