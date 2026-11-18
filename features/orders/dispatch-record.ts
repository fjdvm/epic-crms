/** The courier booking recorded when a Delivery Order is dispatched. Rules shared by the form and the server action. */

export const COURIERS = ["Lalamove", "Grab"] as const;
export type CourierName = (typeof COURIERS)[number];

export const LINK_MAX = 2048;
/** The storefront's rider rules, so a bad value is caught on the form instead of being refused after saving. */
export const RIDER_NAME_MAX = 120;
export const RIDER_PLATE_MAX = 16;
export const RIDER_NAME_REASON = `Rider name can only contain letters, spaces, hyphens, apostrophes and periods (up to ${RIDER_NAME_MAX}).`;
export const RIDER_PLATE_REASON = `Plate number can only contain letters, digits, spaces and hyphens (up to ${RIDER_PLATE_MAX}).`;
export const RIDER_PHONE_REASON = "Enter a Philippine mobile number, like 0917 123 4567.";
const NAME_PATTERN = /^[\p{L}\p{M}\s'.-]+$/u;
const PLATE_PATTERN = /^[A-Za-z0-9 -]+$/;
const PHONE_PATTERN = /^(\+?63|0)9\d{9}$/;
/** What the storefront stores for a phone number: separators removed. */
const phoneDigits = (value: string) => value.replace(/[\s().-]/g, "");

/** Null when the rider detail is fine (empty is fine); otherwise what to tell Staff. */
export function riderProblem(field: "name" | "plate" | "phone", value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (field === "name") return text.length <= RIDER_NAME_MAX && NAME_PATTERN.test(text) ? null : RIDER_NAME_REASON;
  if (field === "plate") return text.length <= RIDER_PLATE_MAX && PLATE_PATTERN.test(text) ? null : RIDER_PLATE_REASON;
  return PHONE_PATTERN.test(phoneDigits(text)) ? null : RIDER_PHONE_REASON;
}
export const LINK_REASON = `Enter the booking's share link as a web address starting with https:// (up to ${LINK_MAX} characters), or leave it empty.`;

/** What Staff typed for the booking. The link and every rider detail are optional. */
export interface CourierInput { courier: string; trackingUrl?: string; riderName?: string; riderPlate?: string; riderPhone?: string }

/** One Order's booking as stored; the rider is `null` for viewers who may not see it. */
export interface DispatchRecord {
  courier: CourierName;
  trackingUrl: string | null;
  rider: { name: string | null; plate: string | null; phone: string | null } | null;
}

/** Null when the link is fine (an empty one is fine); otherwise what to tell Staff. */
export function linkProblem(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  if (text.length > LINK_MAX || /\s/.test(text)) return LINK_REASON;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return LINK_REASON;
  } catch { return LINK_REASON; }
  return null;
}

const optional = (value: string | undefined) => value?.trim() || undefined;

export type BookingCheck =
  | { ok: true; booking: { name: CourierName; trackingUrl?: string; riderName?: string; riderPlate?: string; riderPhone?: string } }
  | { ok: false; reason: string };

/** Courier is required; the link, when given, must be https. Rider details are trimmed and length-limited. */
export function checkBooking(input: CourierInput | undefined): BookingCheck {
  const name = COURIERS.find(courier => courier === input?.courier);
  if (!name) return { ok: false, reason: "Choose Lalamove or Grab." };
  const problem = linkProblem(input?.trackingUrl);
  if (problem) return { ok: false, reason: problem };
  const link = optional(input?.trackingUrl);
  const riderIssue = riderProblem("name", input?.riderName) ?? riderProblem("plate", input?.riderPlate) ?? riderProblem("phone", input?.riderPhone);
  if (riderIssue) return { ok: false, reason: riderIssue };
  const phone = optional(input?.riderPhone);
  const rider = { riderName: optional(input?.riderName), riderPlate: optional(input?.riderPlate), riderPhone: phone && phoneDigits(phone) };
  return { ok: true, booking: {
    name, ...(link && { trackingUrl: new URL(link).href }),
    ...(rider.riderName && { riderName: rider.riderName }),
    ...(rider.riderPlate && { riderPlate: rider.riderPlate }),
    ...(rider.riderPhone && { riderPhone: rider.riderPhone }),
  } };
}
