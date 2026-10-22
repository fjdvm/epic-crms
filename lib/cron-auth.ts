import { timingSafeEqual } from "node:crypto";

/**
 * Whether a cron route's caller sent `Authorization: Bearer $CRON_SECRET`, the credential the GitHub Actions
 * schedules use. With no CRON_SECRET configured, nobody is let in.
 */
export function cronAuthorised(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const given = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);

  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
