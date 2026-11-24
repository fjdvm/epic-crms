import { AI_INSIGHTS_MODULES } from "@/features/ai-insights/load";
import { explainSuggestion } from "@/features/ai-insights/suggestion-store";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { DASHBOARD_MODULE } from "@/lib/portal/config";
import { heldModules, requireModule } from "@/lib/portal/staff";

const headers = { "Cache-Control": "private, no-store" };

/** Asked for by a Manager's page open, one suggestion at a time. Never a timer; Admin and Staff never cause a model call. */
export async function POST(request: Request) {
  if (request.headers.get("x-creoms-ai-insight-explain") !== "1" || request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ why: null }, { status: 403, headers });
  const staff = await requireModule(DASHBOARD_MODULE);
  const modules = await heldModules(AI_INSIGHTS_MODULES);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.key !== "string" || body.key.length > 300) return Response.json({ why: null }, { status: 400, headers });
  const why = await explainSuggestion({ source: database(), crms: crmsDatabase() }, staff, modules, body.key);
  return Response.json({ why }, { headers });
}
