import { database } from "@/lib/db";
import { FULFILMENT_MODULE, ORDERS_MODULE, PAYMENTS_MODULE, RETURNS_MODULE, SENIOR_PWD_MODULE } from "@/lib/portal/config";
import { heldModules, requireAnyModule } from "@/lib/portal/staff";
import { crmsDatabase } from "@/lib/crms-db";
import { loadIdReadFlags } from "@/features/senior-pwd/id-reader";
import { listVerifications } from "@/features/senior-pwd/verifications";

import { approvals } from "./server";
import { idCheckToView, toView, type ApprovalView } from "./view";

/** The Modules whose requests land on the Approvals page. */
export const APPROVAL_MODULES = [RETURNS_MODULE, PAYMENTS_MODULE, FULFILMENT_MODULE, ORDERS_MODULE, SENIOR_PWD_MODULE] as const;

/**
 * Everything the signed-in person may see on Approvals, newest first: the requests raised under each Module they hold
 * (Staff see only their own) and the Senior/PWD ID checks. One Module being unreadable never hides the others.
 */
export async function loadApprovalRows(): Promise<{ staff: Awaited<ReturnType<typeof requireAnyModule>>; rows: ApprovalView[]; unavailable: string[] }> {
  const staff = await requireAnyModule(APPROVAL_MODULES);
  const held = await heldModules(APPROVAL_MODULES);
  const unavailable: string[] = [];
  const rows: ApprovalView[] = [];

  await Promise.all(held.map(async (module) => {
    try {
      if (module === SENIOR_PWD_MODULE) {
        const { pending, decided } = await listVerifications(database(), new Date());
        // The ID reader's flags are extra help; the list still shows without them.
        const flags = await loadIdReadFlags(crmsDatabase(), pending.map((v) => v.id)).catch(() => new Map<number, string[]>());
        rows.push(...[...pending, ...decided].map((v) => idCheckToView(v, flags.get(v.id)?.length)));
        return;
      }
      if (module === FULFILMENT_MODULE) {
        const { syncCancellationRequests } = await import("@/features/orders/cancellation-sync");
        await syncCancellationRequests();
      }
      const found = await approvals().list(staff, module);
      rows.push(...found.map((row) => toView(row as unknown as Record<string, unknown>)));
    } catch (error) {
      console.error(`Approvals could not read ${module}`, error);
      unavailable.push(module);
    }
  }));

  rows.sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));

  return { staff, rows, unavailable };
}
