import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { readCustomers, syncNewCustomers } from "@/features/notifications/notifications";
import { syncFeedbackEvents } from "@/features/notifications/feedback-events";
import { syncTicketEvents } from "@/features/notifications/ticket-events";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { ticketsDatabase } from "@/lib/tickets-db";

export const dynamic = "force-dynamic";

function authorised(header: string | null, secret: string): boolean {
  const given = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);

  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Finds Customers, Ticket events and low-rating Feedback CREOMS has not seen yet and creates their notifications.
 * Called by a scheduler, not by a browser, so it is outside the Portal session and
 * authenticated by a bearer secret instead.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CREOMS_SYNC_SECRET;

  if (!secret || !authorised(request.headers.get("authorization"), secret)) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const customers = await syncNewCustomers(crmsDatabase(), await readCustomers(database()));
    // The reply keeps the New Customer fields at the top level, as before.
    const tickets = await syncTicketEvents(crmsDatabase(), ticketsDatabase());

    // Feedback is last and isolated: its failure must not hide the syncs that already succeeded.
    const feedback = await syncFeedbackEvents(crmsDatabase(), ticketsDatabase()).catch((error) => {
      console.error("Feedback notification sync failed", error);

      return { error: "sync failed" };
    });

    return NextResponse.json({ ...customers, tickets, feedback });
  } catch (error) {
    console.error("Notification sync failed", error);

    return NextResponse.json({ error: "sync failed" }, { status: 500 });
  }
}
