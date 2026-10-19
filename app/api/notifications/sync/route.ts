import { NextResponse, type NextRequest } from "next/server";

import { readCustomers, syncNewCustomers } from "@/features/notifications/notifications";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Finds Customers CREOMS has not seen yet and creates their New Customer notifications.
 * Called by a scheduler, not by a browser, so it is outside the Portal session and
 * authenticated by a bearer secret instead.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CREOMS_SYNC_SECRET;

  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const result = await syncNewCustomers(crmsDatabase(), await readCustomers(database()));

    return NextResponse.json(result);
  } catch (error) {
    console.error("New Customer sync failed", error);

    return NextResponse.json({ error: "sync failed" }, { status: 500 });
  }
}
