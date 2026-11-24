import { AI_INSIGHTS_MODULES } from "@/features/ai-insights/load";
import { decideSuggestion } from "@/features/ai-insights/suggestion-store";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { DASHBOARD_MODULE } from "@/lib/portal/config";
import { canSeeAiInsights, heldModules, requireModule } from "@/lib/portal/staff";

const headers = { "Cache-Control": "private, no-store" };

/** A Manager-level person accepts or dismisses one suggestion. Changes nothing in the shop; logged with their name. */
export async function POST(request: Request) {
  if (request.headers.get("x-creoms-ai-insight") !== "1" || request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ ok: false, reason: "Forbidden request." }, { status: 403, headers });
  const staff = await requireModule(DASHBOARD_MODULE);
  if (!canSeeAiInsights(staff.role)) return Response.json({ ok: false, reason: "Your Role cannot open AI Insights." }, { status: 403, headers });
  const modules = await heldModules(AI_INSIGHTS_MODULES);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.key !== "string" || body.key.length > 300 || (body.decision !== "accepted" && body.decision !== "dismissed") ||
    !body.numbers || Array.isArray(body.numbers) || typeof body.numbers !== "object" || Object.keys(body.numbers).length > 10 ||
    Object.values(body.numbers).some((n) => typeof n !== "number" || !Number.isSafeInteger(n)))
    return Response.json({ ok: false, reason: "Invalid suggestion." }, { status: 400, headers });
  const result = await decideSuggestion({ source: database(), crms: crmsDatabase() }, gatewayAuditTrail, staff, modules,
    body.key, body.numbers, body.decision);
  return Response.json(result, { status: result.ok ? 200 : 409, headers });
}
