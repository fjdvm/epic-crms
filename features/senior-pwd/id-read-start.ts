import { after } from "next/server";

import { configuredVisionModels } from "@/lib/ai/structured";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { fetchReturnPhoto } from "@/features/returns/photo-bytes";
import { readPendingIdPhotos } from "./id-reader";

/** The ID reader's dependencies as production wires them. */
export const idReaderDeps = () => ({
  crms: crmsDatabase(), storefront: database(), models: configuredVisionModels(), fetchImage: fetchReturnPhoto, audit: gatewayAuditTrail,
});

/**
 * Starts the ID reader for any waiting Senior/PWD ID with no result yet, after the response is sent. Never throws and
 * never waits. The storefront signals right after an ID is sent; reading is idempotent (one claimed row per verification),
 * so repeated or concurrent signals never read an ID twice.
 */
export function startIdRead(): void {
  try {
    after(async () => {
      try {
        await readPendingIdPhotos(idReaderDeps());
      } catch (error) {
        console.error("The Senior/PWD ID reader could not run", error);
      }
    });
  } catch (error) {
    console.error("The Senior/PWD ID reader could not be scheduled", error);
  }
}
