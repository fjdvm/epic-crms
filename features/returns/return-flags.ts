import type postgres from "postgres";

import { DEFAULT_AUTOMATIC_CHECKS, type AutomaticChecks } from "@/features/settings/automatic-checks";
import { fingerprintImage, fingerprintsSimilar, isFingerprint } from "./image-fingerprint";

/** Defaults, and what Settings changes: this many Returns requested in this many days up to and including this one. */
export const FREQUENT_RETURNS_COUNT = 3;
export const FREQUENT_RETURNS_DAYS = 90;
type Rule = { count: number; days: number };
const DEFAULT_RULE: Rule = { count: FREQUENT_RETURNS_COUNT, days: FREQUENT_RETURNS_DAYS };
const DAY = 24 * 60 * 60 * 1000;

export type ReturnFlagRule = "frequent-returns" | "similar-photo";
/** A flag only informs Staff. Nothing reads it to block or decline a Return. */
export interface ReturnFlag {
  rule: ReturnFlagRule;
  /** Names the rule in plain words. */
  text: string;
  /** The earlier Returns it points at, for Staff to compare. */
  earlier: { id: number; number: string }[];
}
const rma = (id: number) => ({ id, number: `RMA-${id}` });

export function frequentReturnsFlag(
  self: { id: number; requestedAt: Date },
  sameCustomer: { id: number; requestedAt: Date; status: string }[],
  rule: Rule = DEFAULT_RULE,
): ReturnFlag | null {
  const from = self.requestedAt.getTime() - rule.days * DAY;
  const counted = sameCustomer.filter(r => r.status !== "cancelled" && r.requestedAt.getTime() > from && r.requestedAt.getTime() <= self.requestedAt.getTime());
  const all = [...counted.filter(r => r.id !== self.id), { id: self.id }];
  if (all.length < rule.count) return null;
  const earlier = counted.filter(r => r.id !== self.id).sort((a, b) => a.id - b.id).map(r => rma(r.id));

  return { rule: "frequent-returns", earlier,
    text: `This Customer has ${all.length} Returns in the last ${rule.days} days.` };
}

/** Only photos of earlier Returns count, so the first use of a photo is never flagged. */
export function similarPhotoFlag(
  mine: string[],
  earlier: { returnId: number; fingerprint: string }[],
  selfId: number,
): ReturnFlag | null {
  const ids = new Set<number>();
  for (const photo of mine) {
    for (const other of earlier) if (other.returnId < selfId && fingerprintsSimilar(photo, other.fingerprint)) ids.add(other.returnId);
  }
  if (ids.size === 0) return null;

  return { rule: "similar-photo", earlier: [...ids].sort((a, b) => a - b).map(rma),
    text: "An evidence photo looks like one already used on another Return, even if cropped or re-saved." };
}

/** Flags for the given Returns. Reads only; a read failure is the caller's to handle (no flags shown). */
export async function loadReturnFlags(
  reader: postgres.Sql,
  crms: postgres.Sql,
  ids: number[],
  settings: AutomaticChecks["returns"] = DEFAULT_AUTOMATIC_CHECKS.returns,
): Promise<Map<number, ReturnFlag[]>> {
  const flags = new Map<number, ReturnFlag[]>();
  if (ids.length === 0) return flags;
  const selves = await reader<{ id: number; customer_id: string; requested_at: Date }[]>`
    select r.id, o.customer_id, r.requested_at from public.order_returns r
    join public.orders o on o.id = r.order_id where r.id in ${reader(ids)}`;
  if (selves.length === 0) return flags;
  const customers = [...new Set(selves.map(r => r.customer_id))];
  const frequent = settings.frequentReturns;
  const [history, prints] = await Promise.all([
    reader<{ id: number; customer_id: string; requested_at: Date; status: string }[]>`
      select r.id, o.customer_id, r.requested_at, r.status from public.order_returns r
      join public.orders o on o.id = r.order_id
      where o.customer_id in ${reader(customers)}
        and r.requested_at > ${new Date(Math.min(...selves.map(r => r.requested_at.getTime())) - frequent.days * DAY)}`,
    crms<{ return_id: number; fingerprint: string }[]>`select return_id, fingerprint from crms.return_photo_fingerprints`,
  ]);
  const usable = prints.filter(p => isFingerprint(p.fingerprint)).map(p => ({ returnId: p.return_id, fingerprint: p.fingerprint }));
  for (const self of selves) {
    const found: ReturnFlag[] = [];
    const count = !frequent.enabled ? null : frequentReturnsFlag({ id: self.id, requestedAt: self.requested_at },
      history.filter(r => r.customer_id === self.customer_id).map(r => ({ id: r.id, requestedAt: r.requested_at, status: r.status })), frequent);
    if (count) found.push(count);
    const similar = !settings.reusedPhoto.enabled ? null : similarPhotoFlag(usable.filter(p => p.returnId === self.id).map(p => p.fingerprint), usable, self.id);
    if (similar) found.push(similar);
    flags.set(self.id, found);
  }

  return flags;
}

/**
 * Computes and keeps the fingerprint of each evidence photo that has none yet. The bytes come from our
 * own file storage via `fetchPhoto`; nothing goes to an outside service. A photo that cannot be read or
 * decoded is skipped (no fingerprint, no flag) and tried again next time. `limit` caps the work of one call.
 */
export async function fingerprintReturnPhotos(
  reader: postgres.Sql,
  crms: postgres.Sql,
  fetchPhoto: (fileId: string) => Promise<Uint8Array>,
  onlyIds?: number[],
  limit = Infinity,
): Promise<number> {
  const images = await reader<{ return_id: number; position: number; file_id: string }[]>`
    select return_id, position, file_id from public.order_return_images
    ${onlyIds ? reader`where return_id in ${reader(onlyIds)}` : reader``}`;
  const done = await crms<{ return_id: number; position: number }[]>`select return_id, position from crms.return_photo_fingerprints`;
  const have = new Set(done.map(d => `${d.return_id}:${d.position}`));
  let added = 0;
  for (const image of images) {
    if (added >= limit) break;
    if (have.has(`${image.return_id}:${image.position}`)) continue;
    try {
      const fingerprint = await fingerprintImage(await fetchPhoto(image.file_id));
      await crms`insert into crms.return_photo_fingerprints (return_id, position, file_id, fingerprint)
        values (${image.return_id}, ${image.position}, ${image.file_id}, ${fingerprint}) on conflict do nothing`;
      added++;
    } catch (error) {
      console.error(`The photo ${image.file_id} could not be fingerprinted`, error);
    }
  }

  return added;
}
