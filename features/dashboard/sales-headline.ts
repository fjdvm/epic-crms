/** What the headline needs of a month; the chart passes the loaded months as they are. */
export type Month = { label: string; sales: number; soFar: boolean };

/** A trend needs at least this many finished months in a row to be worth a sentence. */
const MIN_RUN = 3;

export const NEUTRAL_SALES_TITLE = "Sales, last six months";

const monthName = (label: string) =>
  new Date(`${label}-01T00:00:00Z`).toLocaleString("en-PH", {
    month: "long",
    timeZone: "UTC",
  });

/** The first month of the unbroken run of strictly rising (+1) or falling (-1) months that ends the finished months. */
function runStart(finished: Month[], direction: 1 | -1): Month | null {
  let start = finished.length - 1;

  while (start > 0 && Math.sign(finished[start].sales - finished[start - 1].sales) === direction) start--;

  return finished.length - start >= MIN_RUN ? finished[start] : null;
}

/** Headline templates, tried in order; the first one that is true wins, else a neutral title. The unfinished month is left out of the judgement. */
export function salesHeadline(months: Month[]): string {
  const finished = months.filter((m) => !m.soFar);
  const grown = runStart(finished, 1);
  if (grown) return `Sales have grown every month since ${monthName(grown.label)}`;

  const fallen = runStart(finished, -1);
  if (fallen) return `Sales have fallen every month since ${monthName(fallen.label)}`;

  return NEUTRAL_SALES_TITLE;
}

/** How the month still in progress stands against the whole of the month before it. */
export function soFarNote(months: Month[], format: (centavos: number) => string): string | null {
  const current = months.find((m) => m.soFar);
  const index = current ? months.indexOf(current) : -1;
  if (!current || index < 1) return null;

  const previous = months[index - 1];
  if (previous.sales === 0) return "No Sales last month";

  const name = monthName(previous.label);
  if (current.sales === previous.sales) return `Level with ${name}'s ${format(previous.sales)}`;
  if (current.sales > previous.sales) return `Already ahead of ${name}'s ${format(previous.sales)}`;

  return `${Math.floor((current.sales / previous.sales) * 100)}% of ${name}'s ${format(previous.sales)} so far`;
}
