import { crmsDatabase } from "@/lib/crms-db";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";
import { openTicketSummary } from "@/features/tickets/summary";

const headers = { "Cache-Control": "private, no-store" };

/** A mounted Ticket opens this independently of the manual Server Action queue. No CORS is enabled. */
export async function POST(request: Request) {
  // A custom header requires browser CORS preflight; cross-site forms cannot generate summaries.
  if (request.headers.get("x-creoms-ticket-open") !== "1" || request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "forbidden" }, { status: 403, headers });
  const staff = await requireModule(TICKETS_MODULE);
  const body = await request.json().catch(() => null);
  const ticketId = body?.ticketId;
  if (!Number.isSafeInteger(ticketId) || ticketId < 1 || ticketId > 999_999_999)
    return Response.json({ error: "invalid-ticket" }, { status: 400, headers });
  try {
    const result = await openTicketSummary({ tickets: ticketsDatabase(), crms: crmsDatabase() }, staff, ticketId);
    return Response.json(result, { headers });
  } catch {
    return Response.json({ summary: null, unavailable: true }, { headers });
  }
}
