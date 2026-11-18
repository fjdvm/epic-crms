// Pure helpers, safe for the browser: the form and the server share them.
export const MAX_THRESHOLD_IN_CENTAVOS = 100_000_000; // ₱1,000,000
export type ThresholdResult = { ok: true; thresholdInCentavos: number } | { ok: false; reason: string };

export const pesos = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: centavos % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** A peso amount typed by a person ("2500", "₱2,500", "2,500.50") to centavos; refuses anything else, in plain words. */
export function parseThreshold(input: unknown): ThresholdResult {
  const text = typeof input === "string" ? input.trim().replace(/^₱\s*/, "") : typeof input === "number" ? String(input) : "";
  if (!text) return { ok: false, reason: "Enter the Free delivery threshold in pesos." };
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(text)) return { ok: false, reason: "Enter a peso amount such as 2500 or 2,500.50." };
  const centavos = Math.round(Number(text.replace(/,/g, "")) * 100);
  if (centavos <= 0) return { ok: false, reason: "The threshold must be more than ₱0, or every Order would ship free." };
  if (centavos > MAX_THRESHOLD_IN_CENTAVOS) return { ok: false, reason: `The threshold can be at most ${pesos(MAX_THRESHOLD_IN_CENTAVOS)}.` };
  return { ok: true, thresholdInCentavos: centavos };
}

