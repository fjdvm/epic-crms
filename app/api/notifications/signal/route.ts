import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { crmsDatabase } from "@/lib/crms-db";
import { signalNotifications } from "@/features/notifications/signal";
import { syncNotifications } from "@/features/notifications/sync";
import { nudgeStaff } from "@/features/notifications/staff-live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const secret = process.env.CREOMS_SIGNAL_SECRET;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  if (!secret || secret.length < 32 || given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return new NextResponse(null, { status: 401 });
  }
  // Ignore every body field and query parameter: signals cannot manufacture or select events.
  try {
    const result = await signalNotifications(crmsDatabase(), () => syncNotifications(), nudgeStaff);
    return NextResponse.json({ accepted: true, coalesced: result.coalesced }, { status: 202 });
  } catch (error) {
    console.error("Staff signal sync failed", error);
    return NextResponse.json({ error: "sync unavailable" }, { status: 503 });
  }
}
