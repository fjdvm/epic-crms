import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { MANAGEMENT_MODULE } from "@/lib/portal/config";
import { canManage } from "@/lib/portal/roles";

import { describeDiscount, parseDiscount, type DiscountKind, type DiscountPer, type DiscountResult, type SeniorPwdDiscount } from "./senior-pwd-discount-format";

type Row = { kind: DiscountKind; hundredths: string; limit: string; per: DiscountPer };
const toDiscount = (r: Row): SeniorPwdDiscount => ({ kind: r.kind, hundredths: Number(r.hundredths), limitInCentavos: Number(r.limit), per: r.per });

/** The saved rule, or null when it cannot be read. The storefront reads the same row to price the discount. */
export async function loadSeniorPwdDiscount(sql: postgres.Sql): Promise<SeniorPwdDiscount | null> {
  const [row] = await sql<Row[]>`select discount_kind as kind, discount_hundredths::text as hundredths, limit_in_centavos::text as limit, limit_per as per
    from crms.senior_pwd_discount_settings where singleton`;
  return row ? toDiscount(row) : null;
}

type Staff = { id: string; name: string; role: string };

/** Manager only, checked here and not only on the page. Saved at once and audited with the old and new rule. */
export async function changeSeniorPwdDiscount(sql: postgres.Sql, audit: AuditTrail, staff: Staff, input: unknown): Promise<DiscountResult> {
  if (!canManage(staff)) return { ok: false, reason: "Only a Manager can change the Senior/PWD discount." };
  const valid = parseDiscount(input);
  if (!valid.ok) return valid;
  const next = valid.discount;

  const previous = await sql.begin(async (tx) => {
    const [row] = await tx<Row[]>`select discount_kind as kind, discount_hundredths::text as hundredths, limit_in_centavos::text as limit, limit_per as per
      from crms.senior_pwd_discount_settings where singleton for update`;
    await tx`insert into crms.senior_pwd_discount_settings (singleton, discount_kind, discount_hundredths, limit_in_centavos, limit_per, changed_by_id, changed_by_name, changed_at)
      values (true, ${next.kind}, ${next.hundredths}, ${next.limitInCentavos}, ${next.per}, ${staff.id}, ${staff.name}, now())
      on conflict (singleton) do update set discount_kind = excluded.discount_kind, discount_hundredths = excluded.discount_hundredths,
        limit_in_centavos = excluded.limit_in_centavos, limit_per = excluded.limit_per,
        changed_by_id = excluded.changed_by_id, changed_by_name = excluded.changed_by_name, changed_at = excluded.changed_at`;
    return row ? toDiscount(row) : null;
  });

  await recordAudit(audit, {
    module: MANAGEMENT_MODULE, action: "senior_pwd_discount.changed", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "setting", id: "senior-pwd-discount", display_name: "Senior/PWD discount" },
    description: `${staff.name} changed the Senior/PWD discount from ${previous ? describeDiscount(previous) : "an unknown rule"} to ${describeDiscount(next)}.`,
    occurred_at: new Date().toISOString(), metadata: { previous, next }, operationId: `senior-pwd-discount:${randomUUID()}`,
  });
  return { ok: true, discount: next };
}
