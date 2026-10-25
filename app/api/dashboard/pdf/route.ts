import { loadDashboardFigures } from "@/features/dashboard/figures";
import { PERIOD_PRESETS, resolvePeriod } from "@/features/dashboard/period";
import { dashboardPdf } from "@/features/dashboard/pdf";
import { DASHBOARD_DATA_MODULES, DASHBOARD_MODULE } from "@/lib/portal/config";
import { heldModules, requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

export const runtime = "nodejs";

/** A read-only download; access is checked before any figures or assets are loaded. */
export async function GET(request: Request) {
  await requireModule(DASHBOARD_MODULE);
  const raw = new URL(request.url).searchParams.get("period");
  const preset = PERIOD_PRESETS.find((preset) => preset === raw) ?? "7-days";
  const now = new Date();
  const period = resolvePeriod(preset, now);
  const modules = await heldModules(DASHBOARD_DATA_MODULES);
  const figures = await loadDashboardFigures(ticketsDatabase, { period, modules, now });
  const pdf = await dashboardPdf(figures, { period, preset, now });
  const date = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="dashboard-${preset}-${date}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
