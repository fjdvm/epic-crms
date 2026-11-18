import { NextResponse, type NextRequest } from "next/server";

import { configuredVisionModels } from "@/lib/ai/structured";
import { cronAuthorised } from "@/lib/cron-auth";
import { crmsDatabase } from "@/lib/crms-db";
import { reportLiveError } from "@/lib/error-monitor";
import { gatewayAuditTrail } from "@/lib/gateway";
import { ticketsDatabase } from "@/lib/tickets-db";
import { fetchReturnPhoto } from "@/features/returns/photo-bytes";
import { readPendingProofs } from "@/features/orders/proof-reader";
import { readPendingRefundProofs } from "@/features/returns/refund-proof-reader";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The Proof reader's background run (#595, refund proofs #614). A scheduler (or the storefront, with `?proof=<id>`; CREOMS itself, with `?refund=<return id>` right after a refund proof is saved) calls it with
 * `Authorization: Bearer $CRON_SECRET`; a Customer's submit never waits for it and Staff opening a proof never calls it.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorised(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  const proof = Number(request.nextUrl.searchParams.get("proof"));
  const refund = Number(request.nextUrl.searchParams.get("refund"));
  const only = (n: number) => (Number.isSafeInteger(n) && n > 0 ? n : undefined);

  try {
    const deps = { crms: crmsDatabase(), storefront: ticketsDatabase(), models: configuredVisionModels(), fetchImage: fetchReturnPhoto, audit: gatewayAuditTrail };
    // `?proof=` or `?refund=` names one proof; naming one kind skips the other kind's sweep.
    const named = only(proof) !== undefined || only(refund) !== undefined;
    const result = named && only(proof) === undefined ? undefined : await readPendingProofs(deps, only(proof));
    const refunds = named && only(refund) === undefined ? undefined : await readPendingRefundProofs(deps, only(refund));

    return NextResponse.json({ ...result, ...(refunds ? { refunds } : {}) });
  } catch (error) {
    console.error("The Proof reader run failed", error);
    await reportLiveError("cron:proof-reader", error);

    return NextResponse.json({ error: "proof reader failed" }, { status: 500 });
  }
}
