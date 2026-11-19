"use server";

import { approvals } from "@/features/approvals/server";
import { saveAutomaticChecks as save } from "@/features/settings/automatic-checks-server";
import { setServiceTargets } from "@/features/tickets/service-level-store";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { requireManagement } from "@/lib/portal/staff";

type Saved = { ok: true } | { ok: false; reason: string };

/** Each action re-checks the Module and the Manager or CEO Role on the server; the store checks the Role again. Never optimistic. */
export async function changeApprovalLimit(amountInCentavos: number): Promise<Saved> {
  const staff = await requireManagement();
  try {
    const result = await approvals().setLimit(staff, amountInCentavos);
    return result.ok ? { ok: true } : { ok: false, reason: "reason" in result ? String(result.reason) : "The Approval limit could not be changed." };
  } catch (error) {
    console.error("Approval limit could not be saved", error);
    return { ok: false, reason: "CREOMS could not save the Approval limit. Nothing was saved." };
  }
}

export async function changeServiceLevels(firstReplyHours: number, resolveHours: number): Promise<Saved> {
  const staff = await requireManagement();
  try {
    const result = await setServiceTargets(crmsDatabase(), gatewayAuditTrail, staff, { firstReplyHours, resolveHours });
    return result.ok ? { ok: true } : result;
  } catch (error) {
    console.error("Service levels could not be saved", error);
    return { ok: false, reason: "CREOMS could not save the Service levels. Nothing was saved." };
  }
}

export async function changeAutomaticChecks(checks: unknown): Promise<Saved> {
  const staff = await requireManagement();
  try {
    const result = await save(crmsDatabase(), gatewayAuditTrail, staff, checks);
    return result.ok ? { ok: true } : result;
  } catch (error) {
    console.error("Automatic checks could not be saved", error);
    return { ok: false, reason: "CREOMS could not save the Automatic checks. Nothing was saved." };
  }
}
