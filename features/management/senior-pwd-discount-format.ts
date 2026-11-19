// Pure helpers, safe for the browser: the form and the server share them.
import { MAX_THRESHOLD_IN_CENTAVOS, pesos } from "./threshold-format";

export type DiscountKind = "percent" | "pesos";
export type DiscountPer = "day" | "week" | "month";
export const DISCOUNT_KINDS: readonly DiscountKind[] = ["percent", "pesos"];
export const DISCOUNT_PERIODS: readonly DiscountPer[] = ["day", "week", "month"];

/** `hundredths` is a percentage times 100 (500 = 5%) or centavos, by `kind`. The limit is centavos per period. */
export interface SeniorPwdDiscount { kind: DiscountKind; hundredths: number; limitInCentavos: number; per: DiscountPer }
export type DiscountResult = { ok: true; discount: SeniorPwdDiscount } | { ok: false; reason: string };

/** A positive amount with up to two decimals ("1,500", "₱125.50", "5") in hundredths, or null. */
function hundredths(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim().replace(/^₱\s*/, "") : typeof value === "number" ? String(value) : "";
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text.replace(/,/g, "")) * 100);
}

export function parseDiscount(input: unknown): DiscountResult {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const kind = DISCOUNT_KINDS.find((k) => k === o.kind);
  if (!kind) return { ok: false, reason: "Choose whether the discount is a percentage or an amount in pesos." };
  const per = DISCOUNT_PERIODS.find((p) => p === o.per);
  if (!per) return { ok: false, reason: "Choose whether the limit is per day, week or month." };

  const amount = hundredths(o.amount);
  if (amount === null) return { ok: false, reason: kind === "percent" ? "Enter the discount as a percentage such as 5 or 7.5." : "Enter the discount in pesos such as 125 or 125.50." };
  if (amount <= 0) return { ok: false, reason: "The discount must be more than zero." };
  if (kind === "percent" && amount > 10000) return { ok: false, reason: "A percentage discount can be at most 100%." };
  if (kind === "pesos" && amount > MAX_THRESHOLD_IN_CENTAVOS) return { ok: false, reason: `The discount can be at most ${pesos(MAX_THRESHOLD_IN_CENTAVOS)}.` };

  const limit = hundredths(o.limit);
  if (limit === null) return { ok: false, reason: "Enter the limit in pesos such as 1500." };
  if (limit <= 0) return { ok: false, reason: "The limit must be more than ₱0." };
  if (limit > MAX_THRESHOLD_IN_CENTAVOS) return { ok: false, reason: `The limit can be at most ${pesos(MAX_THRESHOLD_IN_CENTAVOS)}.` };
  if (kind === "pesos" && amount > limit) return { ok: false, reason: `A discount of ${pesos(amount)} is over the limit of ${pesos(limit)} per ${per}.` };

  return { ok: true, discount: { kind, hundredths: amount, limitInCentavos: limit, per } };
}

/** "5% off, up to ₱1,500 per week". */
export function describeDiscount(d: SeniorPwdDiscount): string {
  const off = d.kind === "percent" ? `${d.hundredths / 100}%` : pesos(d.hundredths);
  return `${off} off, up to ${pesos(d.limitInCentavos)} per ${d.per}`;
}
