import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { crmsDatabase } from "@/lib/crms-db";
import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { shopRole } from "@/lib/portal/roles";

import {
  AUTOMATIC_CHECK_GROUPS, DEFAULT_AUTOMATIC_CHECKS, loadAutomaticChecks, resolveAutomaticChecks, validateAutomaticChecks,
  type AutomaticChecks, type ChecksResult,
} from "./automatic-checks";

const groups = AUTOMATIC_CHECK_GROUPS;
type Plain = Record<string, Record<string, Record<string, number | boolean>>>;

/** For the evaluators' callers: CREOMS's own database, with the defaults if it cannot be reached. */
export async function currentAutomaticChecks(): Promise<AutomaticChecks> {
  try { return await loadAutomaticChecks(crmsDatabase()); }
  catch (error) { console.error("Automatic checks could not be read; using the defaults", error); return DEFAULT_AUTOMATIC_CHECKS; }
}

type Staff = { id: string; name: string; role: string };

/** The rules whose switch or numbers differ between two sets, as plain labels. */
function changedRules(before: AutomaticChecks, after: AutomaticChecks): string[] {
  const a = before as unknown as Plain, b = after as unknown as Plain;
  return Object.entries(groups).flatMap(([g, group]) => Object.entries(group.rules)
    .filter(([r]) => JSON.stringify(a[g][r]) !== JSON.stringify(b[g][r])).map(([, rule]) => rule.label));
}

/** Admin only. The whole set is saved at once; the change is audited under the Admin's name. */
export async function saveAutomaticChecks(sql: postgres.Sql, audit: AuditTrail, staff: Staff, input: unknown): Promise<ChecksResult> {
  if (shopRole(staff.role) !== "admin") return { ok: false, reason: "Only an Admin can change the Automatic checks." };
  const valid = validateAutomaticChecks(input);
  if (!valid.ok) return valid;
  const next = valid.checks;

  const previous = await sql.begin(async tx => {
    const [row] = await tx<{ settings: unknown }[]>`select settings from crms.automatic_checks where singleton for update`;
    const [cod] = await tx<{ amount: string }[]>`select first_order_amount_in_centavos::text as amount from crms.cod_settings where singleton for update`;
    const before = resolveAutomaticChecks(row?.settings);
    if (cod) before.cod.firstOrderOverAmount.amountInCentavos = Number(cod.amount);
    await tx`insert into crms.automatic_checks (singleton, settings, changed_by_id, changed_by_name, changed_at)
      values (true, ${tx.json(next as never)}, ${staff.id}, ${staff.name}, now())
      on conflict (singleton) do update set settings = excluded.settings, changed_by_id = excluded.changed_by_id,
        changed_by_name = excluded.changed_by_name, changed_at = excluded.changed_at`;
    await tx`update crms.cod_settings set first_order_amount_in_centavos = ${next.cod.firstOrderOverAmount.amountInCentavos},
      changed_by_id = ${staff.id}, changed_by_name = ${staff.name}, changed_at = now() where singleton`;
    return before;
  });

  const changed = changedRules(previous, next);
  await recordAudit(audit, {
    module: "Portal Settings", action: "automatic_checks.changed", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "setting", id: "automatic-checks", display_name: "Automatic checks" },
    description: changed.length
      ? `${staff.name} changed the Automatic checks: ${changed.join(", ")}.`
      : `${staff.name} saved the Automatic checks without changes.`,
    occurred_at: new Date().toISOString(), metadata: { previous, next, changed }, operationId: `automatic-checks:${randomUUID()}`,
  });
  return { ok: true, checks: next };
}
