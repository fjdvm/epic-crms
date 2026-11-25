import { AI_INSIGHTS_MODULES } from "@/features/ai-insights/insights";
import { answerInsight, dismissInsight, parseDays } from "@/features/ai-insights/store";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { DASHBOARD_MODULE } from "@/lib/portal/config";
import { canSeeAiInsights, heldModules, requireModule } from "@/lib/portal/staff";

const headers = { "Cache-Control": "private, no-store" };

/**
 * "Dismiss for me" and "Was this useful?" on one AI insight. Personal, so Manager-level Roles and Admin may both do it;
 * neither changes anything in the shop.
 */
export async function POST(request: Request) {
  if (request.headers.get("x-creoms-ai-insight") !== "1" || request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ ok: false, reason: "Forbidden request." }, { status: 403, headers });
  const staff = await requireModule(DASHBOARD_MODULE);
  if (!canSeeAiInsights(staff.role)) return Response.json({ ok: false, reason: "Your Role cannot open AI insights." }, { status: 403, headers });
  const body = await request.json().catch(() => null);
  const days = parseDays(body?.days);
  if (!body || !days || typeof body.key !== "string" || body.key.length > 300 ||
    (body.action !== "dismiss" && !(body.action === "feedback" && typeof body.helpful === "boolean")))
    return Response.json({ ok: false, reason: "Invalid request." }, { status: 400, headers });
  const modules = await heldModules(AI_INSIGHTS_MODULES);
  const result = body.action === "dismiss"
    ? await dismissInsight(crmsDatabase(), gatewayAuditTrail, staff, modules, days, body.key)
    : await answerInsight(crmsDatabase(), staff, modules, days, body.key, body.helpful);
  return Response.json(result, { status: result.ok ? 200 : 409, headers });
}
