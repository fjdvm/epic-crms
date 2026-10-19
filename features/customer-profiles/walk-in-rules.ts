export const SOURCES = ["Website", "Messenger", "Instagram", "TikTok", "Walk-in", "Referral", "Event / expo"] as const;
export const PREFERRED_CONTACTS = ["Email", "SMS", "Phone call", "Messenger"] as const;

export interface WalkInAddress {
  street: string;
  province: string;
  city: string;
  barangay: string;
  zip: string;
  landmark: string;
}

/** What the Add customer form submits: every field is raw text or a toggle, nothing is trusted yet. */
export interface WalkInInput {
  firstName?: string;
  lastName?: string;
  mobile?: string;
  email?: string;
  birthday?: string;
  preferredContact?: string;
  source?: string;
  tags?: string[];
  emailConsent?: boolean;
  smsConsent?: boolean;
  notes?: string;
  address?: Partial<WalkInAddress>;
}

export interface WalkInData {
  firstName: string;
  lastName: string;
  /** Normalised: 11 digits starting 09. */
  mobile: string;
  email: string | null;
  /** YYYY-MM-DD. */
  birthday: string | null;
  preferredContact: string | null;
  source: string | null;
  tags: string[];
  emailConsent: boolean;
  smsConsent: boolean;
  notes: string | null;
  address: WalkInAddress | null;
}

export type WalkInField = "firstName" | "lastName" | "mobile" | "email" | "birthday" | "preferredContact" | "source";

export type WalkInValidation =
  { ok: true; value: WalkInData } | { ok: false; errors: Partial<Record<WalkInField, string>> };

/** An 11-digit Philippine mobile number (09XXXXXXXXX), from any usual spelling; null if it is not one. */
export function normaliseMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("63") ? `0${digits.slice(2)}` : digits;

  return /^09\d{9}$/.test(local) ? local : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function blank(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
}

export function validateWalkIn(input: WalkInInput, today: Date = new Date()): WalkInValidation {
  const errors: Partial<Record<WalkInField, string>> = {};

  const firstName = blank(input.firstName);
  const lastName = blank(input.lastName);
  if (!firstName) errors.firstName = "First name is required.";
  if (!lastName) errors.lastName = "Last name is required.";

  const mobileRaw = blank(input.mobile);
  const mobile = mobileRaw ? normaliseMobile(mobileRaw) : null;
  if (!mobileRaw) errors.mobile = "Mobile number is required.";
  else if (!mobile) errors.mobile = "Enter an 11-digit Philippine mobile number, like 0917 123 4567.";

  const emailRaw = blank(input.email);
  const email = emailRaw?.toLowerCase() ?? null;
  if (email && !EMAIL.test(email)) errors.email = "Enter a complete email address, like name@example.com.";

  const birthday = blank(input.birthday);
  if (birthday) {
    const date = new Date(`${birthday}T00:00:00Z`);
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(birthday) && !Number.isNaN(date.getTime()) && date <= today;
    if (!valid) errors.birthday = "Enter a valid birthday that is not in the future.";
  }

  const preferredContact = blank(input.preferredContact);
  if (preferredContact && !(PREFERRED_CONTACTS as readonly string[]).includes(preferredContact)) {
    errors.preferredContact = "Choose one of the listed contact methods.";
  }

  const source = blank(input.source);
  if (source && !(SOURCES as readonly string[]).includes(source)) errors.source = "Choose one of the listed sources.";

  if (Object.keys(errors).length > 0 || !firstName || !lastName || !mobile) return { ok: false, errors };

  const entered = {
    street: input.address?.street?.trim() ?? "",
    province: input.address?.province?.trim() ?? "",
    city: input.address?.city?.trim() ?? "",
    barangay: input.address?.barangay?.trim() ?? "",
    zip: input.address?.zip?.trim() ?? "",
    landmark: input.address?.landmark?.trim() ?? "",
  };

  return {
    ok: true,
    value: {
      firstName,
      lastName,
      mobile,
      email,
      birthday,
      preferredContact,
      source,
      tags: [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))],
      emailConsent: input.emailConsent === true,
      smsConsent: input.smsConsent === true,
      notes: blank(input.notes),
      address: Object.values(entered).some(Boolean) ? entered : null,
    },
  };
}
