import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { runAnalysis } from "@/features/feedback/analysis";
import { configuredClients } from "@/features/feedback/sentiment-clients";
import { feedbackWriterDatabase } from "@/lib/feedback-db";
import { writeAuditEvent } from "@/lib/gateway";

export const dynamic = "force-dynamic";
// A run asks a model about each unlabelled Feedback, one after another.
export const maxDuration = 300;

function authorised(header: string | null, secret: string): boolean {
  const given = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);

  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * The scheduled Feedback analysis, run five times a day by the GitHub Actions workflow in
 * .github/workflows/feedback-analysis.yml, which sends `Authorization: Bearer $CRON_SECRET`. Called by a
 * scheduler, not a browser, so it is outside the Portal session.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret || !authorised(request.headers.get("authorization"), secret)) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const result = await runAnalysis({
      sql: feedbackWriterDatabase(),
      ...configuredClients(),
      actor: { kind: "schedule" },
      audit: writeAuditEvent,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Scheduled Feedback analysis failed", error);

    return NextResponse.json({ error: "analysis failed" }, { status: 500 });
  }
}
