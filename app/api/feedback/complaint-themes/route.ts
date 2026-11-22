import { crmsDatabase } from "@/lib/crms-db";
import { FEEDBACK_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";
import { openComplaintThemes } from "@/features/feedback/complaint-themes";

const headers = { "Cache-Control": "private, no-store" };
const day = (value: unknown) => value === undefined || value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));

/**
 * Called when a Manager opens the Feedback page for a period, and by Refresh (`refresh: true`). Never on a timer, focus or
 * visibility. The Role comes from the session; Staff get nothing and Admin only read the kept result.
 */
export async function POST(request: Request) {
  if (request.headers.get("x-creoms-complaint-themes") !== "1" || request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "forbidden" }, { status: 403, headers });
  const staff = await requireModule(FEEDBACK_MODULE);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !day(body.from) || !day(body.to) || (body.refresh !== undefined && typeof body.refresh !== "boolean"))
    return Response.json({ error: "invalid-period" }, { status: 400, headers });
  try {
    const result = await openComplaintThemes({ tickets: ticketsDatabase(), crms: crmsDatabase() }, staff,
      { from: body.from ?? undefined, to: body.to ?? undefined }, { refresh: body.refresh === true });
    return Response.json(result, { status: result.refused ? 403 : 200, headers });
  } catch {
    return Response.json({ themes: null, unavailable: true }, { headers });
  }
}
