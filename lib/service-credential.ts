import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Checks a short-lived HS256 JWT another system presents to CREOMS: signed with one of `secrets` (the current one, or
 * the previous one while it rotates), for exactly this issuer, audience and scope, and valid for at most 15 minutes.
 */
const MIN_SECRET = 32;
const MAX_LIFETIME_SECONDS = 15 * 60;
const SKEW_SECONDS = 60;

export interface ServiceCredential {
  secrets: (string | undefined)[];
  iss: string;
  aud: string;
  scope: string;
}

const sign = (input: string, secret: string) => createHmac("sha256", secret).update(input).digest("base64url");

export function verifyServiceCredential(authorization: string | null, expected: ServiceCredential, now = new Date()): boolean {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [header, payload, signature] = parts;
  const input = `${header}.${payload}`;
  const received = Buffer.from(signature);
  const signed = expected.secrets
    .filter((secret): secret is string => typeof secret === "string" && secret.length >= MIN_SECRET)
    .some((secret) => {
      const wanted = Buffer.from(sign(input, secret));
      return wanted.length === received.length && timingSafeEqual(wanted, received);
    });
  if (!signed) return false;
  try {
    const head = JSON.parse(Buffer.from(header, "base64url").toString());
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const at = Math.floor(now.getTime() / 1000);
    return head.alg === "HS256" && claims.iss === expected.iss && claims.aud === expected.aud && claims.scope === expected.scope
      && Number.isInteger(claims.iat) && Number.isInteger(claims.exp)
      && claims.iat <= at + SKEW_SECONDS && claims.exp > at && claims.exp - claims.iat <= MAX_LIFETIME_SECONDS;
  } catch {
    return false;
  }
}
