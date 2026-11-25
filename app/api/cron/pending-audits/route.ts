import { NextResponse, type NextRequest } from "next/server";

import { cronAuthorised } from "@/lib/cron-auth";
import { crmsDatabase } from "@/lib/crms-db";
import { reportLiveError } from "@/lib/error-monitor";
import { deliverGatewayAuditEvent } from "@/lib/gateway";
import { deliverPendingAudits } from "@/lib/pending-audit";

export const dynamic = "force-dynamic";

/**
 * Retries pending audit records (#743) that the gateway did not accept when the action ran. A scheduler calls it with
 * `Authorization: Bearer $CRON_SECRET`; the record itself keeps its gateway idempotency key, so a retry never adds a second event.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorised(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });

  try {
    return NextResponse.json(await deliverPendingAudits(crmsDatabase(), deliverGatewayAuditEvent, { limit: 50 }));
  } catch (error) {
    console.error("The pending audit retry failed", error);
    await reportLiveError("cron:pending-audits", error);

    return NextResponse.json({ error: "pending audit retry failed" }, { status: 500 });
  }
}
