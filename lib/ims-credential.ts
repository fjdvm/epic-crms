import { verifyServiceCredential } from "./service-credential";

/**
 * The credential the IMS presents when it pushes stock figures: a short-lived HS256 JWT signed with IMS_CREOMS_SECRET
 * (or the previous secret while it rotates). It opens only the stock push.
 */
export function verifyImsStockCredential(authorization: string | null, now = new Date()): boolean {
  return verifyServiceCredential(authorization, {
    secrets: [process.env.IMS_CREOMS_SECRET, process.env.IMS_CREOMS_SECRET_PREVIOUS],
    iss: "ims", aud: "creoms-stock", scope: "stock:push",
  }, now);
}
