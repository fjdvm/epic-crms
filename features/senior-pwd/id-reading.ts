/** What the browser's reading of an ID photo could find. Nothing here is stored or sent: Staff confirm each field. */
export type IdFields = { name: string | null; idNumber: string | null; expiresOn: string | null };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

/** The first date after an "expiry"-style label, in the forms Philippine IDs print. */
function findExpiry(text: string): string | null {
  const label = /(?:valid\s+until|valid\s+thru|expir\w*|expiry\s+date)\s*[:.\-]?\s*([^\n]+)/i.exec(text);
  if (!label) return null;
  const rest = label[1];
  const named = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/.exec(rest);
  if (named) { const m = MONTHS.indexOf(named[2].toLowerCase()) + 1; return m ? isoDate(+named[3], m, +named[1]) : null; }
  const year = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(rest);
  if (year) return isoDate(+year[1], +year[2], +year[3]);
  const day = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(rest);
  return day ? isoDate(+day[3], +day[2], +day[1]) : null;
}

function findName(lines: string[]): string | null {
  const labelled = lines.map((l) => /^name\s*[:.\-]\s*(.+)$/i.exec(l)?.[1]).find(Boolean);
  if (labelled) return labelled.trim();
  // "SURNAME, GIVEN M." in capitals is how these IDs print the holder.
  return lines.find((l) => /^[A-Z][A-Z' -]+,\s*[A-Z][A-Z.' -]+$/.test(l)) ?? null;
}

function findNumber(text: string): string | null {
  const m = /(?:id\s*(?:no|number|#)|no)\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9-]{3,})/i.exec(text);
  return m ? m[1].toUpperCase() : null;
}

/** Turns recognised text into the three fields. A field the text does not show stays empty so Staff type it. */
export function parseIdText(text: string): IdFields {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { name: findName(lines), idNumber: findNumber(text), expiresOn: findExpiry(text) };
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1);

/** The name on the ID matches the account when every word of the account name appears on the ID. */
export function nameMatches(onId: string, accountName: string): boolean {
  const id = new Set(words(onId));
  const account = words(accountName);
  return id.size > 0 && account.length > 0 && account.every((w) => id.has(w));
}
