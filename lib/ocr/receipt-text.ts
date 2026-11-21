/**
 * Turns the text OCR read off a GCash/Maya/bank screenshot into reference, amount and date. Same rules as the storefront's
 * payment screen (`lib/orders/screenshot-reading.ts` in brenraphaels-ecommerce), so both sides read a receipt the same way.
 * Pure: it only extracts; nothing here decides anything about payment.
 */

export type ReadReceipt = {
  /** Digits only. */
  reference?: string;
  amountInCentavos?: number;
  /** `YYYY-MM-DDTHH:mm` as printed on the receipt (Philippine time). */
  paidAt?: string;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (value: number) => String(value).padStart(2, "0");

function readReference(text: string): string | undefined {
  const match = /ref(?:erence)?\.?\s*(?:no\.?|number|#)?\s*[:.#]?\s*(\d[\d ]{4,26}\d)/i.exec(text);
  const digits = match?.[1].replace(/\s+/g, "");
  return digits && digits.length >= 6 && digits.length <= 20 ? digits : undefined;
}

function toCentavos(raw: string): number | undefined {
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : undefined;
}

function readAmount(text: string): number | undefined {
  // OCR often reads the peso sign as P, # or a stray character, so allow any short non-digit gap.
  const labelled = /(?:total\s+amount\s+sent|amount\s+sent|amount\s+paid|amount)\D{0,12}?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/i.exec(text);
  const found = labelled?.[1] ?? /(?:₱|php|\bp)\s?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/i.exec(text)?.[1];
  return found ? toCentavos(found) : undefined;
}

function readDate(text: string): string | undefined {
  const named = /\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?)?/.exec(text);
  let year: number, month: number, day: number, hour: number | undefined, minute: number | undefined, meridiem: string | undefined;
  if (named && MONTHS.includes(named[1].toLowerCase())) {
    month = MONTHS.indexOf(named[1].toLowerCase()) + 1; day = Number(named[2]); year = Number(named[3]);
    if (named[4]) { hour = Number(named[4]); minute = Number(named[5]); meridiem = named[6].toLowerCase(); }
  } else {
    const numeric = /\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(text);
    if (!numeric) return undefined;
    year = Number(numeric[1]); month = Number(numeric[2]); day = Number(numeric[3]);
    if (numeric[4]) { hour = Number(numeric[4]); minute = Number(numeric[5]); }
  }
  if (hour !== undefined && meridiem) hour = (hour % 12) + (meridiem === "p" ? 12 : 0);
  const value = `${year}-${pad(month)}-${pad(day)}T${pad(hour ?? 0)}:${pad(minute ?? 0)}`;
  // Reject calendar nonsense (Feb 30) the same way the server does.
  return new Date(`${value}Z`).toISOString().slice(0, 16) === value ? value : undefined;
}

/** Reads reference, amount and date from recognised text; anything it cannot find is left out for the Customer to type. */
export function readReceiptText(text: string): ReadReceipt {
  const receipt: ReadReceipt = {};
  const reference = readReference(text);
  const amountInCentavos = readAmount(text);
  const paidAt = readDate(text);
  if (reference) receipt.reference = reference;
  if (amountInCentavos !== undefined) receipt.amountInCentavos = amountInCentavos;
  if (paidAt) receipt.paidAt = paidAt;
  return receipt;
}

