import { customerOrders, searchCustomers } from "@/features/tickets/new-ticket";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

/** Reads run independently of the Server Action queue. Never cache Staff data at the CDN. */
export async function GET(request: Request) {
  await requireModule(TICKETS_MODULE);
  const params = new URL(request.url).searchParams;
  const customerId = params.get("customerId");
  try {
    const choices = customerId
      ? await customerOrders(ticketsDatabase(), customerId)
      : await searchCustomers(ticketsDatabase(), params.get("q") ?? "");
    return Response.json(choices, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Ticket choices could not be read", error);
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
