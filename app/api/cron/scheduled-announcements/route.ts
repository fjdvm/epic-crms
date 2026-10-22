import { NextResponse, type NextRequest } from "next/server";

import { sendDue, storefrontSubscribers } from "@/features/marketing/announcements";
import { crmsDatabase } from "@/lib/crms-db";
import { cronAuthorised } from "@/lib/cron-auth";
import { database } from "@/lib/db";
import { gatewayAuditLog, gatewayMarketingMailer } from "@/lib/gateway";

export const dynamic = "force-dynamic";
// A send emails every Subscriber, ten at a time.
export const maxDuration = 300;

/**
 * Sends the Scheduled Announcements whose time has come, run every 5 minutes by the GitHub Actions workflow in
 * .github/workflows/scheduled-announcements.yml, which sends `Authorization: Bearer $CRON_SECRET`. Called by a
 * scheduler, not a browser, so it is outside the Portal session. Overlapping runs are safe: nobody is emailed twice.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorised(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });

  try {
    const result = await sendDue(crmsDatabase(), {
      audit: gatewayAuditLog,
      subscribers: storefrontSubscribers(database()),
      mailer: gatewayMarketingMailer,
      now: () => new Date(),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Scheduled Announcements could not be sent", error);

    return NextResponse.json({ error: "scheduled send failed" }, { status: 500 });
  }
}
