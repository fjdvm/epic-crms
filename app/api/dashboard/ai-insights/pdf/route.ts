import { insightsPdf } from "@/features/ai-insights/pdf";
import { AI_INSIGHTS_MODULES } from "@/features/ai-insights/insights";
import { loadLatestRun } from "@/features/ai-insights/run";
import { parseDays, viewerState, visibleInsights } from "@/features/ai-insights/store";
import { visibleStats } from "@/features/ai-insights/view-model";
import { pdfResponse } from "@/lib/export/pdf-template";
import { crmsDatabase } from "@/lib/crms-db";
import { DASHBOARD_MODULE } from "@/lib/portal/config";
import { canSeeAiInsights, heldModules, requireModule } from "@/lib/portal/staff";

export const runtime = "nodejs";

/** A read-only download of the stored run, as the person sees it. Access is checked before anything is read. */
export async function GET(request: Request) {
  const staff = await requireModule(DASHBOARD_MODULE);
  if (!canSeeAiInsights(staff.role)) return new Response(null, { status: 403 });
  const days = parseDays(new URL(request.url).searchParams.get("days")) ?? 7;
  const crms = crmsDatabase();
  const run = await loadLatestRun(crms, days);
  if (!run) return new Response("No AI insights yet.", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const modules = await heldModules(AI_INSIGHTS_MODULES);
  const { dismissed } = await viewerState(crms, staff, run);
  const now = new Date();
  const pdf = await insightsPdf(run, visibleInsights(run.insights, modules, dismissed), visibleStats(run.stats, modules), now);
  const date = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return pdfResponse(pdf, `ai-insights-${days}-days-${date}.pdf`);
}
