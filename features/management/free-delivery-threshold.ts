import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { MANAGEMENT_MODULE } from "@/lib/portal/config";
import { canManage } from "@/lib/portal/roles";

import { parseThreshold, pesos, type ThresholdResult } from "./threshold-format";

/** The saved threshold in centavos, or null when the setting cannot be read. */
export async function loadFreeDeliveryThreshold(sql: postgres.Sql): Promise<number | null> {
  const [row] = await sql<{ amount: string }[]>`select free_delivery_threshold_in_centavos::text as amount from crms.delivery_settings where singleton`;
  return row ? Number(row.amount) : null;
}

type Staff = { id: string; name: string; role: string };

/** Manager or CEO only, checked here and not only on the page. Saved at once and audited with the old and new value. */
export async function changeFreeDeliveryThreshold(
  sql: postgres.Sql, audit: AuditTrail, staff: Staff, input: unknown, notify: () => Promise<void> = async () => {},
): Promise<ThresholdResult> {
  if (!canManage(staff)) return { ok: false, reason: "Only a Manager or the CEO can change the Free delivery threshold." };
  const valid = parseThreshold(input);
  if (!valid.ok) return valid;
  const next = valid.thresholdInCentavos;

  const previous = await sql.begin(async (tx) => {
    const [row] = await tx<{ amount: string }[]>`select free_delivery_threshold_in_centavos::text as amount from crms.delivery_settings where singleton for update`;
    await tx`insert into crms.delivery_settings (singleton, free_delivery_threshold_in_centavos, changed_by_id, changed_by_name, changed_at)
      values (true, ${next}, ${staff.id}, ${staff.name}, now())
      on conflict (singleton) do update set free_delivery_threshold_in_centavos = excluded.free_delivery_threshold_in_centavos,
        changed_by_id = excluded.changed_by_id, changed_by_name = excluded.changed_by_name, changed_at = excluded.changed_at`;
    return row ? Number(row.amount) : null;
  });

  await recordAudit(audit, {
    module: MANAGEMENT_MODULE, action: "free_delivery_threshold.changed", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "setting", id: "free-delivery-threshold", display_name: "Free delivery threshold" },
    description: `${staff.name} changed the Free delivery threshold from ${previous === null ? "an unknown amount" : pesos(previous)} to ${pesos(next)}.`,
    occurred_at: new Date().toISOString(), metadata: { previous, next }, operationId: `free-delivery-threshold:${randomUUID()}`,
  });
  // Open storefront pages refresh their banner. A failed nudge never undoes the saved change; the next page load shows it.
  try { await notify(); } catch (error) { console.error("Storefront nudge failed; the banner updates on the next page load", error); }
  return { ok: true, thresholdInCentavos: next };
}
