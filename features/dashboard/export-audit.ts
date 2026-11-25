import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { gatewayAuditTrail } from "@/lib/gateway";
import { DASHBOARD_MODULE } from "@/lib/portal/config";

/**
 * Audit Events for the Dashboard exports (#752): the Dashboard PDF and the AI insights PDF. CREOMS has no Reports export
 * yet (the fulfilment and ticket reports only show on screen); when one is built it records through this module.
 * Metadata holds ids and the chosen period only, never figures, insight text or Customer details. Best effort:
 * recordAudit never throws and never blocks the download.
 */
export type DashboardExport = "dashboard.pdf_exported" | "dashboard.ai_insights_pdf_exported";

const TARGETS: Record<DashboardExport, { type: string; display_name: string; what: string }> = {
  "dashboard.pdf_exported": { type: "dashboard-export", display_name: "Dashboard PDF", what: "the Dashboard PDF" },
  "dashboard.ai_insights_pdf_exported": { type: "ai-insights-export", display_name: "AI insights PDF", what: "the AI insights PDF" },
};

/**
 * One event per person, export, choice and minute, so a replayed or retried request records once. Failures carry the
 * reason in the identity too. `choice` is the period preset or the days window.
 */
export async function auditDashboardExport(
  staff: { id: string; name: string },
  action: DashboardExport,
  choice: string,
  result: { outcome: "success" } | { outcome: "failure"; reason: string },
  now = new Date(),
) {
  const { what, ...target } = TARGETS[action];
  const reason = result.outcome === "failure" ? result.reason : null;
  const minute = Math.floor(now.getTime() / 60_000);

  await recordAudit(gatewayAuditTrail, {
    module: DASHBOARD_MODULE,
    action,
    outcome: result.outcome,
    actor: staffAuditActor(staff),
    target: { ...target, id: choice },
    description: reason ? `${staff.name} could not export ${what} (${choice}): ${reason}` : `${staff.name} exported ${what} (${choice})`,
    metadata: reason ? { choice, reason } : { choice },
    occurred_at: now.toISOString(),
    operationId: `dashboard-export:${action}:${staff.id}:${choice}:${reason ?? "ok"}:${minute}`,
  });
}
