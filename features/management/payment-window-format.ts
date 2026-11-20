// Pure helpers, safe for the browser: the form and the server share them.
export const MAX_WINDOW_HOURS = 720; // 30 days
export type WindowResult = { ok: true; hours: number } | { ok: false; reason: string };

export const hoursText = (h: number) => `${h} hour${h === 1 ? "" : "s"}`;

/** Whole hours typed by a person ("24", " 48 ") from 1 to 720; refuses anything else, in plain words. */
export function parseWindowHours(input: unknown): WindowResult {
  const text = typeof input === "string" ? input.trim() : typeof input === "number" ? String(input) : "";
  if (!text) return { ok: false, reason: "Enter the payment window in whole hours." };
  if (!/^\d{1,4}$/.test(text)) return { ok: false, reason: `Enter whole hours from 1 to ${MAX_WINDOW_HOURS}, such as 24.` };
  const hours = Number(text);
  if (hours < 1 || hours > MAX_WINDOW_HOURS) return { ok: false, reason: `The payment window must be from 1 to ${MAX_WINDOW_HOURS} hours.` };
  return { ok: true, hours };
}
