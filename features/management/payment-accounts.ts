import type postgres from "postgres";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { MANAGEMENT_MODULE } from "@/lib/portal/config";
import { canManage } from "@/lib/portal/roles";

import { maskNumber, methodLabel, validateAccount } from "./payment-account-format";

export type PaymentAccountRow = {
  id: string; method: string; label: string; accountName: string; maskedNumber: string; bankName: string | null; active: boolean; hasQr: boolean;
};

export async function listPaymentAccounts(sql: postgres.Sql): Promise<PaymentAccountRow[]> {
  const rows = await sql<{ id: string; method: string; label: string; account_name: string; account_number: string; bank_name: string | null; active: boolean; qr_file_id: string | null }[]>`
    select id, method, label, account_name, account_number, bank_name, active, qr_file_id from crms.payment_accounts order by created_at, id`;
  return rows.map((r) => ({ id: r.id, method: r.method, label: r.label, accountName: r.account_name, maskedNumber: maskNumber(r.account_number), bankName: r.bank_name, active: r.active, hasQr: r.qr_file_id !== null }));
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

/** The Files the QR change touches: the proof of what was uploaded, and removal of the one it replaces. */
export type QrFiles = {
  /** The File behind a ready upload reference this Staff member made for Management, or null when it is not valid. */
  claim(reference: unknown, staffId: string): Promise<{ fileId: string; filename: string } | null>;
  remove(fileId: string): Promise<void>;
};

/** Sets or, with a null reference, removes the QR. The audit names the change, never a signed link or the file's address. */
export async function setPaymentAccountQr(
  sql: postgres.Sql, audit: AuditTrail, files: QrFiles, staff: Staff & { username: string }, accountId: string, reference: string | null,
): Promise<AddAccountResult> {
  if (!canManage(staff)) return { ok: false, reason: "Only a Manager or the CEO can change a Payment account's QR." };
  const claimed = reference === null ? null : await files.claim(reference, staff.username);
  if (reference !== null && !claimed) return { ok: false, reason: "That image upload is invalid or expired. Choose the image again." };

  const [before] = await sql<{ label: string; method: string; qr_file_id: string | null }[]>`
    select label, method, qr_file_id from crms.payment_accounts where id::text = ${accountId}`;
  if (!before) {
    if (claimed) await files.remove(claimed.fileId).catch(() => {});
    return { ok: false, reason: "That Payment account no longer exists." };
  }
  const newId = claimed?.fileId ?? null;
  await sql`update crms.payment_accounts set qr_file_id = ${newId} where id::text = ${accountId}`;

  await recordAudit(audit, {
    module: MANAGEMENT_MODULE, action: newId ? "payment_account.qr_set" : "payment_account.qr_removed", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "payment_account", id: accountId, display_name: before.label },
    description: newId
      ? `${staff.name} ${before.qr_file_id ? "replaced" : "added"} the QR image of the ${methodLabel(before.method)} Payment account “${before.label}”.`
      : `${staff.name} removed the QR image of the ${methodLabel(before.method)} Payment account “${before.label}”.`,
    occurred_at: new Date().toISOString(), metadata: { method: before.method, had_qr: before.qr_file_id !== null, has_qr: newId !== null },
    operationId: `payment-account-qr:${accountId}:${crypto.randomUUID()}`,
  });
  if (before.qr_file_id && before.qr_file_id !== newId) await files.remove(before.qr_file_id).catch(() => {});
  return { ok: true };
}

/** The stored File id of an account's QR, for the signed-link route. Null when there is none. */
export async function qrFileId(sql: postgres.Sql, accountId: string): Promise<string | null> {
  const [row] = await sql<{ qr_file_id: string | null }[]>`select qr_file_id from crms.payment_accounts where id::text = ${accountId}`;
  return row?.qr_file_id ?? null;
}
