import { NextResponse, type NextRequest } from "next/server";

import { configuredVisionModels } from "@/lib/ai/structured";
import { cronAuthorised } from "@/lib/cron-auth";
import { crmsDatabase } from "@/lib/crms-db";
import { reportLiveError } from "@/lib/error-monitor";
import { gatewayAuditTrail } from "@/lib/gateway";
import { ticketsDatabase } from "@/lib/tickets-db";
import { fetchReturnPhoto } from "@/features/returns/photo-bytes";
import { readPendingProofs } from "@/features/orders/proof-reader";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The Proof reader's background run (#595). A scheduler (or the storefront, with `?proof=<id>`) calls it with
 * `Authorization: Bearer $CRON_SECRET`; a Customer's submit never waits for it and Staff opening a proof never calls it.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorised(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  const proof = Number(request.nextUrl.searchParams.get("proof"));

  try {
    const result = await readPendingProofs({
      crms: crmsDatabase(), storefront: ticketsDatabase(), models: configuredVisionModels(),
      fetchImage: fetchReturnPhoto, audit: gatewayAuditTrail,
    }, Number.isSafeInteger(proof) && proof > 0 ? proof : undefined);

    return NextResponse.json(result);
  } catch (error) {
    console.error("The Proof reader run failed", error);
    await reportLiveError("cron:proof-reader", error);

    return NextResponse.json({ error: "proof reader failed" }, { status: 500 });
  }
}
