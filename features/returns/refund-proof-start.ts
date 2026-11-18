import { after } from "next/server";

import { configuredVisionModels } from "@/lib/ai/structured";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { ticketsDatabase } from "@/lib/tickets-db";
import { fetchReturnPhoto } from "./photo-bytes";
import { readPendingRefundProofs } from "./refund-proof-reader";

/** Starts the Proof reader for one just-saved refund proof after the response is sent. Never throws and never waits (#614). */
export function startRefundProofRead(returnId: number): void {
  try {
    after(async () => {
      try {
        await readPendingRefundProofs({ crms: crmsDatabase(), storefront: ticketsDatabase(), models: configuredVisionModels(), fetchImage: fetchReturnPhoto, audit: gatewayAuditTrail }, returnId);
      } catch (error) {
        console.error("The refund Proof reader could not run", error);
      }
    });
  } catch (error) {
    console.error("The refund Proof reader could not be scheduled", error);
  }
}
