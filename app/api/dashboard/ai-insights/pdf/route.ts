import { insightsPdf } from "@/features/ai-insights/pdf";
import { AI_INSIGHTS_MODULES } from "@/features/ai-insights/insights";
import { loadLatestRun } from "@/features/ai-insights/run";
import { parseDays, viewerState, visibleInsights } from "@/features/ai-insights/store";
import { visibleStats } from "@/features/ai-insights/view-model";
import { auditDashboardExport } from "@/features/dashboard/export-audit";
import { pdfResponse } from "@/lib/export/pdf-template";
import { crmsDatabase } from "@/lib/crms-db";
import { DASHBOARD_MODULE } from "@/lib/portal/config";
import { canSeeAiInsights, heldModules, requireModule } from "@/lib/portal/staff";

export const runtime = "nodejs";

/** A download of the stored run, as the person sees it. Access is checked before anything is read. Every export, and every refused or failed one, is audited. */
export async function GET(request: Request) {
  const staff = await requireModule(DASHBOARD_MODULE);
  const days = parseDays(new URL(request.url).searchParams.get("days")) ?? 7;
  const choice = `${days}-days`;
  const now = new Date();
  if (!canSeeAiInsights(staff.role)) {
    await auditDashboardExport(staff, "dashboard.ai_insights_pdf_exported", choice, { outcome: "failure", reason: "role-not-allowed" }, now);

    return new Response(null, { status: 403 });
  }
  let pdf: Buffer;
  try {
    const crms = crmsDatabase();
    const run = await loadLatestRun(crms, days);
    if (!run) {
      await auditDashboardExport(staff, "dashboard.ai_insights_pdf_exported", choice, { outcome: "failure", reason: "no-run" }, now);

      return new Response("No AI insights yet.", { status: 404, headers: { "Cache-Control": "private, no-store" } });
    }
    const modules = await heldModules(AI_INSIGHTS_MODULES);
    const { dismissed } = await viewerState(crms, staff, run);
    pdf = await insightsPdf(run, visibleInsights(run.insights, modules, dismissed), visibleStats(run.stats, modules), now);
  } catch (error) {
    console.error("AI insights PDF could not be made", error);
    await auditDashboardExport(staff, "dashboard.ai_insights_pdf_exported", choice, { outcome: "failure", reason: "unavailable" }, now);

    return new Response("The AI insights PDF could not be made.", { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
  await auditDashboardExport(staff, "dashboard.ai_insights_pdf_exported", choice, { outcome: "success" }, now);
  const date = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return pdfResponse(pdf, `ai-insights-${days}-days-${date}.pdf`);
}
