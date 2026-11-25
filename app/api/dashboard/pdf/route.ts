import { loadDashboardFigures } from "@/features/dashboard/figures";
import { currentPaymentReviewHours, currentUnconfirmedHours } from "@/features/settings/automatic-checks-server";
import { shopRole } from "@/lib/portal/roles";
import { readServiceLevels } from "@/features/tickets/service-level-store";
import { crmsDatabase } from "@/lib/crms-db";
import { PERIOD_PRESETS, resolvePeriod } from "@/features/dashboard/period";
import { dashboardPdf } from "@/features/dashboard/pdf";
import { auditDashboardExport } from "@/features/dashboard/export-audit";
import { DASHBOARD_DATA_MODULES, DASHBOARD_MODULE } from "@/lib/portal/config";
import { heldModules, requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

export const runtime = "nodejs";

/** A download; access is checked before any figures or assets are loaded. Every export, and every one that failed, is audited. */
export async function GET(request: Request) {
  const staff = await requireModule(DASHBOARD_MODULE);
  const raw = new URL(request.url).searchParams.get("period");
  const preset = PERIOD_PRESETS.find((preset) => preset === raw) ?? "7-days";
  const now = new Date();
  const period = resolvePeriod(preset, now);
  let pdf: Buffer;
  try {
    const modules = await heldModules(DASHBOARD_DATA_MODULES);
    const targets = (await readServiceLevels(crmsDatabase))?.history ?? null;
    const figures = await loadDashboardFigures(ticketsDatabase, { period, modules, now, targets, unconfirmedHours: await currentUnconfirmedHours(), reviewHours: await currentPaymentReviewHours(), manager: shopRole(staff.role) === "manager" });
    pdf = await dashboardPdf(figures, { period, preset, now });
  } catch (error) {
    console.error("Dashboard PDF could not be made", error);
    await auditDashboardExport(staff, "dashboard.pdf_exported", preset, { outcome: "failure", reason: "unavailable" }, now);

    return new Response("The Dashboard PDF could not be made.", { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
  await auditDashboardExport(staff, "dashboard.pdf_exported", preset, { outcome: "success" }, now);
  const date = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="dashboard-${preset}-${date}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
