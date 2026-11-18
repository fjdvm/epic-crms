// Pure helpers, safe for the browser: the form and the server share them.
export const PAYMENT_METHODS = [
  { value: "gcash", label: "GCash" },
  { value: "maya", label: "Maya" },
  { value: "bank_transfer", label: "Bank transfer" },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];
export const methodLabel = (method: string) => PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;

export type PaymentAccountInput = { method: PaymentMethod; label: string; accountName: string; accountNumber: string; bankName: string };
export type ValidAccount = { method: PaymentMethod; label: string; accountName: string; accountNumber: string; numberNormalised: string; bankName: string | null };
export type AccountValidation = { ok: true; account: ValidAccount } | { ok: false; reason: string };

/** Only the last four digits ever leave this form: dialogs, lists and the Audit Log. */
export const maskNumber = (number: string) => {
  const digits = number.replace(/\D/g, "");
  return `${"•".repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
};

/** GCash and Maya numbers are Philippine mobile numbers; banks are 10–16 digits. Returns the normalised digits or a reason. */
function normaliseNumber(method: PaymentMethod, raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "Enter the account number." };
  if (!/^\+?[\d\s-]+$/.test(text)) return { ok: false, reason: "The account number can only have digits, spaces and dashes." };
  const digits = text.replace(/\D/g, "");
  if (method === "bank_transfer") {
    if (text.startsWith("+")) return { ok: false, reason: "A bank account number cannot start with +." };
    if (digits.length < 10 || digits.length > 16) return { ok: false, reason: "A bank account number has 10 to 16 digits." };
    return { ok: true, value: digits };
  }
  const local = digits.startsWith("63") && digits.length === 12 ? `0${digits.slice(2)}` : digits;
  if (!/^09\d{9}$/.test(local)) return { ok: false, reason: `A ${methodLabel(method)} number is a mobile number such as 0917 123 4567.` };
  return { ok: true, value: local };
}

export function validateAccount(input: unknown): AccountValidation {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (k: string) => (typeof i[k] === "string" ? (i[k] as string).trim() : "");
  const method = PAYMENT_METHODS.find((m) => m.value === i.method)?.value;
  if (!method) return { ok: false, reason: "Choose GCash, Maya or Bank transfer." };
  const label = text("label"), accountName = text("accountName"), accountNumber = text("accountNumber"), bankName = text("bankName");
  if (!label) return { ok: false, reason: "Enter a label, such as “Main GCash”." };
  if (label.length > 60) return { ok: false, reason: "The label can be at most 60 characters." };
  if (!accountName) return { ok: false, reason: "Enter the account name." };
  if (accountName.length > 100) return { ok: false, reason: "The account name can be at most 100 characters." };
  if (method === "bank_transfer") {
    if (!bankName) return { ok: false, reason: "Enter the bank name." };
    if (bankName.length > 60) return { ok: false, reason: "The bank name can be at most 60 characters." };
  }
  const number = normaliseNumber(method, accountNumber);
  if (!number.ok) return number;
  return { ok: true, account: { method, label, accountName, accountNumber, numberNormalised: number.value, bankName: method === "bank_transfer" ? bankName : null } };
}
