import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness only: answers without the database, the Portal or any secret, so a container check never depends on them. */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
