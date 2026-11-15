import { NextResponse } from "next/server";

import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Readiness: answers 200 only when both databases CREOMS needs (the shared storefront database and its own `crms`
 * schema) answer. Liveness stays in /api/health, so a database outage takes the app out of rotation without
 * restarting it. The failure reason is never sent to the caller.
 */
export async function GET() {
  try {
    await Promise.all([database()`select 1`, crmsDatabase()`select 1`]);

    return NextResponse.json({ status: "ready" });
  } catch (error) {
    console.error("CREOMS is not ready: a database did not answer", error);

    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
