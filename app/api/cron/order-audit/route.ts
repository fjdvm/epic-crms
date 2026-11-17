import { NextResponse, type NextRequest } from "next/server";

import { recordPlacementAudit, type EmailOutcomeRow, type PlacedOrderRow } from "@/features/orders/placement-audit";
import { cronAuthorised } from "@/lib/cron-auth";
import { database } from "@/lib/db";
import { reportLiveError } from "@/lib/error-monitor";
import { gatewayAuditTrail } from "@/lib/gateway";

export const dynamic = "force-dynamic";

/** Orders and email outcomes saved in this window are swept; older ones were recorded by earlier sweeps. */
const WINDOW_HOURS = 48;

/**
 * Records `order.placed` and the confirmation email outcome in the Audit Logs. Called on a schedule by
 * .github/workflows/order-audit.yml with `Authorization: Bearer $CRON_SECRET`. Repeated sweeps are harmless:
 * each event has a stable operation id.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorised(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });

  try {
    const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000);
    const sql = database();
    const orders = await sql<PlacedOrderRow[]>`select id, created_at from public.orders where created_at >= ${since} order by id`;
    const outcomes = await sql<EmailOutcomeRow[]>`
      select order_id, kind, status, reason, updated_at from public.order_email_outcomes where updated_at >= ${since} order by order_id`;
    return NextResponse.json(await recordPlacementAudit(gatewayAuditTrail, orders, outcomes));
  } catch (error) {
    console.error("Order audit sweep failed", error);
    await reportLiveError("cron:order-audit", error);
    return NextResponse.json({ error: "sweep failed" }, { status: 500 });
  }
}
