import { after } from "next/server";

import { configuredVisionModels } from "@/lib/ai/structured";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { ticketsDatabase } from "@/lib/tickets-db";
import { fetchReturnPhoto } from "@/features/returns/photo-bytes";
import { readPendingProofs } from "./proof-reader";

/**
 * Starts the Proof reader for any saved payment proof with no result yet, after the response is sent. Never throws and never waits.
 * The storefront's "Payment" signal arrives right after a proof is saved. Reading is idempotent (one claimed row per proof),
 * so repeated or concurrent signals never read a proof twice.
 */
export function startPaymentProofRead(): void {
  try {
    after(async () => {
      try {
        await readPendingProofs({ crms: crmsDatabase(), storefront: ticketsDatabase(), models: configuredVisionModels(), fetchImage: fetchReturnPhoto, audit: gatewayAuditTrail });
      } catch (error) {
        console.error("The payment Proof reader could not run", error);
      }
    });
  } catch (error) {
    console.error("The payment Proof reader could not be scheduled", error);
  }
}
