/** A Philippine mobile number as 09XXXXXXXXX, or null when it is not one. */
export function normaliseMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("63") ? `0${digits.slice(2)}` : digits;

  return /^09\d{9}$/.test(local) ? local : null;
}
