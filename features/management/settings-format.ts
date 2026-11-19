// Pure helpers, safe for the browser: the settings forms and their tests share them.
export const pesosText = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: centavos % 100 ? 2 : 0 })}`;

/** Parses "5,000" or "5000.50" to whole centavos; null when it is not a nonnegative amount. */
export function toCentavos(text: string): number | null {
  const cleaned = text.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Whole hours from 1 to 8760, or null. */
export function toHours(text: string): number | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= 1 && n <= 8760 ? n : null;
}

/** A whole number from 1 to `max`, or null. */
export function toWhole(text: string, max: number): number | null {
  if (!/^\d{1,10}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= 1 && n <= max ? n : null;
}

/** Whole pesos (no centavos) to centavos, or null. A first-order amount may be 0. */
export function pesosToCentavos(text: string): number | null {
  if (!/^\d{1,12}$/.test(text.trim())) return null;
  return Number(text) * 100;
}

export const centavosToPesos = (centavos: number) => String(Math.floor(centavos / 100));
