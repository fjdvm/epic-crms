import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { MANAGEMENT_MODULE } from "@/lib/portal/config";
import { canManage } from "@/lib/portal/roles";

import { hoursText, parseWindowHours, type WindowResult } from "./payment-window-format";

/** The saved payment window in hours, or null when the setting cannot be read. */
export async function loadPaymentWindow(sql: postgres.Sql): Promise<number | null> {
  const [row] = await sql<{ hours: number }[]>`select hours from crms.payment_window_settings where singleton`;
  return row ? Number(row.hours) : null;
}

type Staff = { id: string; name: string; role: string };

/** Manager or CEO only, checked here and not only on the page. Affects Orders confirmed afterwards; audited with the old and new value. */
export async function changePaymentWindow(sql: postgres.Sql, audit: AuditTrail, staff: Staff, input: unknown): Promise<WindowResult> {
  if (!canManage(staff)) return { ok: false, reason: "Only a Manager or the CEO can change the payment window." };
  const valid = parseWindowHours(input);
  if (!valid.ok) return valid;
  const next = valid.hours;

  const previous = await sql.begin(async (tx) => {
    const [row] = await tx<{ hours: number }[]>`select hours from crms.payment_window_settings where singleton for update`;
    await tx`insert into crms.payment_window_settings (singleton, hours, changed_by_id, changed_by_name, changed_at)
      values (true, ${next}, ${staff.id}, ${staff.name}, now())
      on conflict (singleton) do update set hours = excluded.hours,
        changed_by_id = excluded.changed_by_id, changed_by_name = excluded.changed_by_name, changed_at = excluded.changed_at`;
    return row ? Number(row.hours) : null;
  });

  await recordAudit(audit, {
    module: MANAGEMENT_MODULE, action: "payment_window.changed", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "setting", id: "payment-window", display_name: "Payment window" },
    description: `${staff.name} changed the payment window from ${previous === null ? "an unknown time" : hoursText(previous)} to ${hoursText(next)}.`,
    occurred_at: new Date().toISOString(), metadata: { previous, next }, operationId: `payment-window:${randomUUID()}`,
  });
  return { ok: true, hours: next };
}
