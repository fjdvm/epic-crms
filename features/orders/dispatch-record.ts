/** The courier booking recorded when a Delivery Order is dispatched. Rules shared by the form and the server action. */

export const COURIERS = ["Lalamove", "Grab"] as const;
export type CourierName = (typeof COURIERS)[number];

export const LINK_MAX = 2048;
export const RIDER_MAX = 100;
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
  const rider = { riderName: optional(input?.riderName), riderPlate: optional(input?.riderPlate), riderPhone: optional(input?.riderPhone) };
  if (Object.values(rider).some(value => value !== undefined && value.length > RIDER_MAX)) {
    return { ok: false, reason: `Rider details can be up to ${RIDER_MAX} characters each.` };
  }
  return { ok: true, booking: {
    name, ...(link && { trackingUrl: new URL(link).href }),
    ...(rider.riderName && { riderName: rider.riderName }),
    ...(rider.riderPlate && { riderPlate: rider.riderPlate }),
    ...(rider.riderPhone && { riderPhone: rider.riderPhone }),
  } };
}
