import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The credential the IMS presents when it pushes stock figures: a short-lived HS256 JWT signed with IMS_CREOMS_SECRET
 * (or the previous secret while it rotates). It opens only the stock push.
 */
const MIN_SECRET = 32;
const MAX_LIFETIME_SECONDS = 15 * 60;
const SKEW_SECONDS = 60;

function secrets(): string[] {
  return [process.env.IMS_CREOMS_SECRET, process.env.IMS_CREOMS_SECRET_PREVIOUS]
    .filter((secret): secret is string => typeof secret === "string" && secret.length >= MIN_SECRET);
}

const sign = (input: string, secret: string) => createHmac("sha256", secret).update(input).digest("base64url");

export function verifyImsStockCredential(authorization: string | null, now = new Date()): boolean {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [header, payload, signature] = parts;
  const input = `${header}.${payload}`;
  const received = Buffer.from(signature);
  const signed = secrets().some((secret) => {
    const expected = Buffer.from(sign(input, secret));
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
  if (!signed) return false;
  try {
    const head = JSON.parse(Buffer.from(header, "base64url").toString());
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const at = Math.floor(now.getTime() / 1000);
    return head.alg === "HS256" && claims.iss === "ims" && claims.aud === "creoms-stock" && claims.scope === "stock:push"
      && Number.isInteger(claims.iat) && Number.isInteger(claims.exp)
      && claims.iat <= at + SKEW_SECONDS && claims.exp > at && claims.exp - claims.iat <= MAX_LIFETIME_SECONDS;
  } catch {
    return false;
  }
}
