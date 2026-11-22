import { explainUnusualActivity } from "@/features/dashboard/unusual-activity-explain";
import { UNUSUAL_ACTIVITY_MODULES } from "@/features/dashboard/unusual-activity";
import { database } from "@/lib/db";
import { crmsDatabase } from "@/lib/crms-db";
import { DASHBOARD_MODULE } from "@/lib/portal/config";
import { heldModules, requireModule } from "@/lib/portal/staff";

const headers = { "Cache-Control": "private, no-store" };

/** Asked for by a Dashboard open, one alert at a time. Never a timer; Admin and CEO never cause a model call. */
export async function POST(request: Request) {
  if (request.headers.get("x-creoms-alert-explain") !== "1" || request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ explanation: null }, { status: 403, headers });
  const staff = await requireModule(DASHBOARD_MODULE);
  const modules = await heldModules(UNUSUAL_ACTIVITY_MODULES);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.key !== "string" || body.key.length > 1000)
    return Response.json({ explanation: null }, { status: 400, headers });
  const explanation = await explainUnusualActivity({ source: database(), crms: crmsDatabase() }, staff, modules, body.key);
  return Response.json({ explanation }, { headers });
}
