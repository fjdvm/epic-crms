import { AI_INSIGHTS_MODULES } from "@/features/ai-insights/insights";
import { loadEvidence, parseDays } from "@/features/ai-insights/store";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { DASHBOARD_MODULE } from "@/lib/portal/config";
import { canSeeAiInsights, heldModules, requireModule } from "@/lib/portal/staff";

const headers = { "Cache-Control": "private, no-store" };

/** The records behind one card, read when its Evidence drawer opens. Read-only. */
export async function GET(request: Request) {
  const staff = await requireModule(DASHBOARD_MODULE);
  if (!canSeeAiInsights(staff.role)) return Response.json({ ok: false, reason: "Your Role cannot open AI insights." }, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  const days = parseDays(params.get("days"));
  const key = params.get("key");
  if (!days || !key || key.length > 300) return Response.json({ ok: false, reason: "Invalid request." }, { status: 400, headers });
  const modules = await heldModules(AI_INSIGHTS_MODULES);
  try {
    const result = await loadEvidence({ source: database(), crms: crmsDatabase() }, staff, modules, days, key);
    return Response.json(result, { status: result.ok ? 200 : 409, headers });
  } catch {
    return Response.json({ ok: false, reason: "Couldn't load the records. Please try again." }, { status: 500, headers });
  }
}
