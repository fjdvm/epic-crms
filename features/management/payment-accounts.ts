import type postgres from "postgres";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { MANAGEMENT_MODULE } from "@/lib/portal/config";
import { canManage } from "@/lib/portal/roles";

import { maskNumber, methodLabel, validateAccount } from "./payment-account-format";

export type PaymentAccountRow = {
  id: string; method: string; label: string; accountName: string; maskedNumber: string; bankName: string | null; active: boolean;
};

export async function listPaymentAccounts(sql: postgres.Sql): Promise<PaymentAccountRow[]> {
  const rows = await sql<{ id: string; method: string; label: string; account_name: string; account_number: string; bank_name: string | null; active: boolean }[]>`
    select id, method, label, account_name, account_number, bank_name, active from crms.payment_accounts order by created_at, id`;
  return rows.map((r) => ({ id: r.id, method: r.method, label: r.label, accountName: r.account_name, maskedNumber: maskNumber(r.account_number), bankName: r.bank_name, active: r.active }));
}

type Staff = { id: string; name: string; role: string };
export type AddAccountResult = { ok: true } | { ok: false; reason: string };

/** Manager or CEO only, checked here and not only on the page. The Audit Log never holds more than the last four digits. */
export async function addPaymentAccount(sql: postgres.Sql, audit: AuditTrail, staff: Staff, input: unknown): Promise<AddAccountResult> {
  if (!canManage(staff)) return { ok: false, reason: "Only a Manager or the CEO can add a Payment account." };
  const valid = validateAccount(input);
  if (!valid.ok) return valid;
  const a = valid.account;

  const [row] = await sql<{ id: string }[]>`
    insert into crms.payment_accounts (method, label, account_name, account_number, number_normalised, bank_name, created_by_id, created_by_name)
    values (${a.method}, ${a.label}, ${a.accountName}, ${a.accountNumber}, ${a.numberNormalised}, ${a.bankName}, ${staff.id}, ${staff.name})
    on conflict (method, number_normalised) do nothing returning id`;
  if (!row) return { ok: false, reason: `A ${methodLabel(a.method)} account with that number already exists.` };

  const masked = maskNumber(a.numberNormalised);
  await recordAudit(audit, {
    module: MANAGEMENT_MODULE, action: "payment_account.added", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "payment_account", id: row.id, display_name: a.label },
    description: `${staff.name} added the ${methodLabel(a.method)} Payment account “${a.label}” (${masked}).`,
    occurred_at: new Date().toISOString(), metadata: { method: a.method, bank_name: a.bankName, number_last4: a.numberNormalised.slice(-4) },
    operationId: `payment-account-added:${row.id}`,
  });
  return { ok: true };
}
