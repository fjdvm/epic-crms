import { verifyServiceCredential } from "./service-credential";

/**
 * The credential the POS presents when it reads CREOMS's online Sales: a short-lived HS256 JWT signed with
 * POS_CREOMS_SECRET (or the previous secret while it rotates). It opens only the online sales feed.
 */
export function verifyPosSalesCredential(authorization: string | null, now = new Date()): boolean {
  return verifyServiceCredential(authorization, {
    secrets: [process.env.POS_CREOMS_SECRET, process.env.POS_CREOMS_SECRET_PREVIOUS],
    iss: "pos", aud: "creoms-sales", scope: "sales:read",
  }, now);
}
