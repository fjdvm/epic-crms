import { NextResponse, type NextRequest } from "next/server";

import { runInsights } from "@/features/ai-insights/run";
import { cronAuthorised } from "@/lib/cron-auth";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { reportLiveError } from "@/lib/error-monitor";

export const dynamic = "force-dynamic";
// Reads both periods and asks a model to word each (complaint themes and notes), one after another.
export const maxDuration = 300;

/**
 * The AI insights morning run, at 6:00 am Philippine time, by the GitHub Actions workflow in
 * .github/workflows/ai-insights.yml, which sends `Authorization: Bearer $CRON_SECRET`. The only caller that ever makes
 * AI insights ask a model. Called by a scheduler, not a browser, so it is outside the Portal session.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorised(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });

  try {
    const runs = await runInsights({ source: database(), crms: crmsDatabase() });
    return NextResponse.json({ runs });
  } catch (error) {
    console.error("Scheduled AI insights run failed", error);
    await reportLiveError("cron:ai-insights", error);
    return NextResponse.json({ error: "run failed" }, { status: 500 });
  }
}
