/**
 * One validator per Customer profile field, shared by every server path that writes a profile.
 * Each returns an error message in plain words, or null when the value is fine. There is no age field.
 */
export type FieldError = string | null;

const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
const CONTACT_NUMBER = /^\+?\d+$/;
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const ADDRESS = /^[\p{L}\p{M}\p{N} .,'’#/&()-]+$/u;

export const NAME_MAX = 100;
export const EMAIL_MAX = 254;
export const ADDRESS_MAX = 200;
export const CONTACT_NUMBER_MIN = 7;
export const CONTACT_NUMBER_MAX = 15;

function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

export function validateName(value: unknown, label = "Name"): FieldError {
  const v = text(value);
  if (!v) return `${label} is required.`;
  if (v.length > NAME_MAX) return `${label} can have at most ${NAME_MAX} characters.`;
  if (!NAME.test(v)) return `${label} can only have letters, spaces, hyphens, apostrophes and periods.`;
  return null;
}

export function validateContactNumber(value: unknown): FieldError {
  const v = text(value);
  if (!v) return "Contact number is required.";
  if (!CONTACT_NUMBER.test(v)) return "Contact number can only have digits, with an optional + at the start.";
  const digits = v.replace("+", "").length;
  if (digits < CONTACT_NUMBER_MIN || digits > CONTACT_NUMBER_MAX) {
    return `Contact number must have ${CONTACT_NUMBER_MIN} to ${CONTACT_NUMBER_MAX} digits.`;
  }
  return null;
}

export function validateEmail(value: unknown): FieldError {
  const v = text(value);
  if (!v) return "Email is required.";
  if (v.length > EMAIL_MAX) return `Email can have at most ${EMAIL_MAX} characters.`;
  if (!EMAIL.test(v) || v.includes("..")) return "Enter a valid email address, like name@example.com.";
  return null;
}

export function validateAddressField(value: unknown, label = "Address"): FieldError {
  const v = text(value);
  if (!v) return `${label} is required.`;
  if (v.length > ADDRESS_MAX) return `${label} can have at most ${ADDRESS_MAX} characters.`;
  if (!ADDRESS.test(v)) return `${label} can only have letters, digits, spaces and . , ' # / & ( ) - .`;
  return null;
}

const VALIDATORS: Record<string, (value: unknown) => FieldError> = {
  firstName: (v) => validateName(v, "First name"),
  lastName: (v) => validateName(v, "Last name"),
  fullName: (v) => validateName(v, "Name"),
  contactNumber: validateContactNumber,
  email: validateEmail,
  street: (v) => validateAddressField(v, "Street"),
  barangay: (v) => validateAddressField(v, "Barangay"),
  city: (v) => validateAddressField(v, "City"),
  province: (v) => validateAddressField(v, "Province"),
};

export type ProfileFieldErrors = Record<string, string>;

/**
 * Checks every submitted field of a profile update. Unknown fields (including any age field) are
 * rejected, so a crafted request cannot slip extra data past the form.
 */
export function validateProfileUpdate(input: unknown): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { _: "Send the profile fields to update." };
  for (const [field, value] of Object.entries(input)) {
    const validate = Object.hasOwn(VALIDATORS, field) ? VALIDATORS[field] : null;
    if (!validate) { errors[field] = "This field cannot be updated."; continue; }
    const error = validate(value);
    if (error) errors[field] = error;
  }
  return errors;
}

const NOT_NAME = /[^\p{L}\p{M} .'’-]/gu;
const NOT_ADDRESS = /[^\p{L}\p{M}\p{N} .,'’#/&()-]/gu;
const NOT_EMAIL = /[^A-Za-z0-9.!#$%&'*+/=?^_`{|}~@-]/g;

const MASKS: Record<string, { clean: (v: string) => string; max: number }> = {
  firstName: { clean: (v) => v.replace(NOT_NAME, ""), max: NAME_MAX },
  lastName: { clean: (v) => v.replace(NOT_NAME, ""), max: NAME_MAX },
  fullName: { clean: (v) => v.replace(NOT_NAME, ""), max: NAME_MAX },
  contactNumber: {
    clean: (v) => {
      const kept = v.replace(/[^\d+]/g, "");
      return (kept.startsWith("+") ? "+" : "") + kept.replace(/\+/g, "");
    },
    max: CONTACT_NUMBER_MAX + 1,
  },
  email: { clean: (v) => v.replace(NOT_EMAIL, ""), max: EMAIL_MAX },
  street: { clean: (v) => v.replace(NOT_ADDRESS, ""), max: ADDRESS_MAX },
  barangay: { clean: (v) => v.replace(NOT_ADDRESS, ""), max: ADDRESS_MAX },
  city: { clean: (v) => v.replace(NOT_ADDRESS, ""), max: ADDRESS_MAX },
  province: { clean: (v) => v.replace(NOT_ADDRESS, ""), max: ADDRESS_MAX },
};

/**
 * The input mask: strips what a field never allows, so typing or pasting an invalid character has
 * no effect. Allowed-character sets match the validators above; the validators stay the authority.
 */
export function maskProfileInput(field: string, value: string): string {
  const mask = Object.hasOwn(MASKS, field) ? MASKS[field] : null;
  return mask ? mask.clean(value).slice(0, mask.max) : value;
}

/** The message the server would return for one field, or null when valid. */
export function validateProfileField(field: string, value: string): FieldError {
  return validateProfileUpdate({ [field]: value })[field] ?? null;
}
