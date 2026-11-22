import { NextResponse, type NextRequest } from "next/server";

import { cronAuthorised } from "@/lib/cron-auth";
import { reportLiveError } from "@/lib/error-monitor";
import { idReaderDeps } from "@/features/senior-pwd/id-read-start";
import { readPendingIdPhotos } from "@/features/senior-pwd/id-reader";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The ID reader's backstop run. A scheduler calls it with `Authorization: Bearer $CRON_SECRET` (optionally `?id=<verification>`);
 * the main trigger is the storefront's signal. A Customer's submit never waits for it and opening a check never calls it.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorised(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  const id = Number(request.nextUrl.searchParams.get("id"));
  try {
    return NextResponse.json(await readPendingIdPhotos(idReaderDeps(), Number.isSafeInteger(id) && id > 0 ? id : undefined));
  } catch (error) {
    console.error("The ID reader run failed", error);
    await reportLiveError("cron:id-reader", error);
    return NextResponse.json({ error: "id reader failed" }, { status: 500 });
  }
}
