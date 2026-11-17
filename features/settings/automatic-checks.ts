import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { crmsDatabase } from "@/lib/crms-db";
import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { shopRole } from "@/lib/portal/roles";

/**
 * Portal Settings, Automatic checks (#528). Every flag-only rule has an on/off switch and, where it
 * has one, editable numbers. The defaults are today's behaviour, so nothing changes until an Admin
 * changes it. These rules only ever flag; none of them blocks. The Senior/PWD duplicate-ID check is
 * deliberately absent: it is not configurable.
 */
interface Field { min: number; max: number; default: number; label: string }
interface Rule { label: string; fields: Record<string, Field> }

const MAX = 9_007_199_254_740_991;
const count = (def: number, label: string): Field => ({ min: 1, max: 1000, default: def, label });
const days = (def: number, label: string): Field => ({ min: 1, max: 3650, default: def, label });

export const AUTOMATIC_CHECK_GROUPS: Record<string, { label: string; rules: Record<string, Rule> }> = {
  paymentProof: {
    label: "GCash proof checks",
    rules: {
      reference: { label: "Reference already used on another Order", fields: {} },
      amount: { label: "Amount matches the Order total", fields: {} },
      date: { label: "Payment date is after the Order was placed", fields: {} },
      recipient: { label: "Recipient matches the shop account", fields: {} },
    },
  },
  cod: {
    label: "Cash on Delivery rules",
    rules: {
      firstOrder: { label: "First order", fields: {} },
      firstOrderOverAmount: {
        label: "First order over an amount",
        fields: { amountInCentavos: { min: 0, max: MAX, default: 150_000, label: "Amount in centavos" } },
      },
      earlierRefusal: { label: "Phone refused an earlier Order", fields: {} },
      earlierFailedDelivery: { label: "Earlier failed delivery", fields: {} },
    },
  },
  returns: {
    label: "Returns rules",
    rules: {
      frequentReturns: { label: "Many Returns by one Customer", fields: { count: count(3, "Returns"), days: days(90, "Days") } },
      reusedPhoto: { label: "Photo already used on another Return", fields: {} },
    },
  },
  dashboard: {
    label: "Dashboard counts",
    rules: {
      unverifiedPayments: {
        label: "Unverified payments",
        fields: { count: count(5, "Payments"), waitHours: { min: 1, max: 8760, default: 24, label: "Hours a proof may wait" } },
      },
      returnSpike: { label: "Returns on one product", fields: { count: count(3, "Returns"), days: days(7, "Days") } },
      unresolvedFailedDeliveries: { label: "Unresolved failed deliveries", fields: { count: count(3, "Deliveries") } },
    },
  },
};

type Switch = { enabled: boolean };
export interface AutomaticChecks {
  paymentProof: Record<"reference" | "amount" | "date" | "recipient", Switch>;
  cod: {
    firstOrder: Switch;
    firstOrderOverAmount: Switch & { amountInCentavos: number };
    earlierRefusal: Switch;
    earlierFailedDelivery: Switch;
  };
  returns: { frequentReturns: Switch & { count: number; days: number }; reusedPhoto: Switch };
  dashboard: {
    unverifiedPayments: Switch & { count: number; waitHours: number };
    returnSpike: Switch & { count: number; days: number };
    unresolvedFailedDeliveries: Switch & { count: number };
  };
}

type Plain = Record<string, Record<string, Record<string, number | boolean>>>;
const groups = AUTOMATIC_CHECK_GROUPS;

/** Today's behaviour: every rule on, with the numbers the code has always used. */
export const DEFAULT_AUTOMATIC_CHECKS: AutomaticChecks = Object.fromEntries(
  Object.entries(groups).map(([g, group]) => [g, Object.fromEntries(
    Object.entries(group.rules).map(([r, rule]) => [r, {
      enabled: true,
      ...Object.fromEntries(Object.entries(rule.fields).map(([f, field]) => [f, field.default])),
    }]))]),
) as unknown as AutomaticChecks;

const validNumber = (field: Field, n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= field.min && (n as number) <= field.max;

/** Saved values laid over the defaults; anything unknown or invalid falls back to the default. */
export function resolveAutomaticChecks(stored: unknown): AutomaticChecks {
  const saved = (stored && typeof stored === "object" ? stored : {}) as Plain;
  const out = structuredClone(DEFAULT_AUTOMATIC_CHECKS) as unknown as Plain;
  for (const [g, group] of Object.entries(groups)) for (const [r, rule] of Object.entries(group.rules)) {
    const value = saved[g]?.[r];
    if (!value || typeof value !== "object") continue;
    if (typeof value.enabled === "boolean") out[g][r].enabled = value.enabled;
    for (const [f, field] of Object.entries(rule.fields)) if (validNumber(field, value[f])) out[g][r][f] = value[f] as number;
  }
  return out as unknown as AutomaticChecks;
}

export type ChecksResult = { ok: true; checks: AutomaticChecks } | { ok: false; reason: string };

/** The whole set must be sent; each rule needs its switch and every number in range. */
export function validateAutomaticChecks(input: unknown): ChecksResult {
  if (!input || typeof input !== "object") return { ok: false, reason: "Send the Automatic checks to save." };
  const given = input as Plain;
  const out: Plain = {};
  for (const [g, group] of Object.entries(groups)) {
    out[g] = {};
    for (const [r, rule] of Object.entries(group.rules)) {
      const value = given[g]?.[r];
      if (!value || typeof value !== "object") return { ok: false, reason: `${rule.label} is missing.` };
      if (typeof value.enabled !== "boolean") return { ok: false, reason: `${rule.label}: choose on or off.` };
      out[g][r] = { enabled: value.enabled };
      for (const [f, field] of Object.entries(rule.fields)) {
        if (!validNumber(field, value[f]))
          return { ok: false, reason: `${rule.label}: ${field.label} must be a whole number from ${field.min} to ${field.max}.` };
        out[g][r][f] = value[f] as number;
      }
    }
  }
  return { ok: true, checks: out as unknown as AutomaticChecks };
}

/**
 * What the evaluators read, from CREOMS's own database. The first-order amount lives in
 * `crms.cod_settings` (#351), the rest in `crms.automatic_checks`; one view of both. If the database
 * cannot be read the rules keep today's behaviour rather than go quiet.
 */
export async function loadAutomaticChecks(sql: postgres.Sql): Promise<AutomaticChecks> {
  // Read separately: a failure in one (say the migration is pending) must not hide the other.
  const settings = await sql<{ settings: unknown }[]>`select settings from crms.automatic_checks where singleton`
    .then(rows => rows[0]?.settings, error => { console.error("Automatic checks could not be read; using the defaults", error); return undefined; });
  const checks = resolveAutomaticChecks(settings);
  const amount = await sql<{ amount: string }[]>`select first_order_amount_in_centavos::text as amount from crms.cod_settings where singleton`
    .then(rows => rows[0]?.amount, error => { console.error("The Cash on Delivery amount could not be read; using the default", error); return undefined; });
  if (amount !== undefined) checks.cod.firstOrderOverAmount.amountInCentavos = Number(amount);
  return checks;
}

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
