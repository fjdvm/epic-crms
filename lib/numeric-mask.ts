/**
 * What a number field accepts while typing and pasting: `peso` is digits, commas and one dot with at most two
 * decimals; `whole` is digits only (counts, hours, account numbers, phone numbers). Anything else is dropped.
 * The server parsers still decide what is valid; this only stops letters and symbols from being typed at all.
 */
export type NumericKind = "peso" | "whole";

export function maskNumeric(kind: NumericKind, raw: string): string {
  if (kind === "whole") return raw.replace(/\D/g, "");

  const cleaned = raw.replace(/[^\d.,]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;

  return `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/[.,]/g, "").slice(0, 2)}`;
}
