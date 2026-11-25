import type postgres from "postgres";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { MANAGEMENT_MODULE } from "@/lib/portal/config";
import { canManage } from "@/lib/portal/roles";

import { fingerprint, minuteOf, withFailureAudit, type SettingSpec } from "./settings-audit";
import { maskNumber, methodLabel, PAYMENT_METHODS, validateAccount } from "./payment-account-format";

export type PaymentAccountRow = {
  id: string; method: string; label: string; accountName: string; maskedNumber: string; bankName: string | null; active: boolean; hasQr: boolean; used: boolean;
  /** Raw number for the edit form only; the Manager already holds the Module that lists it. */
  accountNumber: string;
};

export async function listPaymentAccounts(sql: postgres.Sql): Promise<PaymentAccountRow[]> {
  const rows = await sql<{ id: string; method: string; label: string; account_name: string; account_number: string; bank_name: string | null; active: boolean; qr_file_id: string | null; first_used_at: Date | null }[]>`
    select id, method, label, account_name, account_number, bank_name, active, qr_file_id, first_used_at from crms.payment_accounts order by created_at, id`;
  return rows.map((r) => ({ id: r.id, method: r.method, label: r.label, accountName: r.account_name, maskedNumber: maskNumber(r.account_number), bankName: r.bank_name, active: r.active, hasQr: r.qr_file_id !== null, used: r.first_used_at !== null, accountNumber: r.account_number }));
}

type Staff = { id: string; name: string; role: string };
export type AddAccountResult = { ok: true } | { ok: false; reason: string };

/** Where a refused or failed Payment account change is recorded: the same action name as its success event. */
const spec = (action: string, what: string, type: string, id: string, display_name: string): SettingSpec =>
  ({ module: MANAGEMENT_MODULE, action, what, target: { type, id, display_name } });

/** Manager only, checked here and not only on the page. The Audit Log never holds more than the last four digits. */
export function addPaymentAccount(sql: postgres.Sql, audit: AuditTrail, staff: Staff, input: unknown): Promise<AddAccountResult> {
  return withFailureAudit(audit, staff, spec("payment_account.added", "add a Payment account", "payment_account", "new", "New Payment account"), () => add(sql, audit, staff, input));
}

async function add(sql: postgres.Sql, audit: AuditTrail, staff: Staff, input: unknown): Promise<AddAccountResult> {
  if (!canManage(staff)) return { ok: false, reason: "Only a Manager can add a Payment account." };
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
export function setPaymentAccountQr(
  sql: postgres.Sql, audit: AuditTrail, files: QrFiles, staff: Staff & { username: string }, accountId: string, reference: string | null,
): Promise<AddAccountResult> {
  const action = reference === null ? "payment_account.qr_removed" : "payment_account.qr_set";
  return withFailureAudit(audit, staff, spec(action, "change a Payment account's QR", "payment_account", accountId, "Payment account"), () => changeQr(sql, audit, files, staff, accountId, reference));
}

async function changeQr(
  sql: postgres.Sql, audit: AuditTrail, files: QrFiles, staff: Staff & { username: string }, accountId: string, reference: string | null,
): Promise<AddAccountResult> {
  if (!canManage(staff)) return { ok: false, reason: "Only a Manager can change a Payment account's QR." };
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
    operationId: `payment-account-qr:${accountId}:${fingerprint(newId)}:${minuteOf(new Date())}`,
  });
  if (before.qr_file_id && before.qr_file_id !== newId) await files.remove(before.qr_file_id).catch(() => {});
  return { ok: true };
}

/** The stored File id of an account's QR, for the signed-link route. Null when there is none. */
export async function qrFileId(sql: postgres.Sql, accountId: string): Promise<string | null> {
  const [row] = await sql<{ qr_file_id: string | null }[]>`select qr_file_id from crms.payment_accounts where id::text = ${accountId}`;
  return row?.qr_file_id ?? null;
}

/** Methods a Manager has switched off. A method with no row is on. */
export async function listDisabledMethods(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<{ method: string }[]>`select method from crms.payment_methods where not enabled`;
  return rows.map((r) => r.method);
}

export type MethodAvailability = Record<(typeof PAYMENT_METHODS)[number]["value"], boolean>;

/** Per method: on only when a Manager has not switched it off and at least one account is active. The storefront reads this, nothing more. */
export async function listMethodAvailability(sql: postgres.Sql): Promise<MethodAvailability> {
  const [disabled, withAccount] = await Promise.all([
    listDisabledMethods(sql),
    sql<{ method: string }[]>`select distinct method from crms.payment_accounts where active`,
  ]);
  const active = new Set(withAccount.map((r) => r.method));
  return Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, active.has(m.value) && !disabled.includes(m.value)])) as MethodAvailability;
}

type Found = { label: string; method: string; active: boolean; account_number: string; bank_name: string | null; first_used_at: Date | null };
const find = async (sql: postgres.Sql, id: string) => (await sql<Found[]>`
  select label, method, active, account_number, bank_name, first_used_at from crms.payment_accounts where id::text = ${id}`)[0];
const MISSING = { ok: false, reason: "That Payment account no longer exists." } as const;

/** Edits an account's details. The method cannot change; add a new account instead. The audit holds the masked number only. */
export function editPaymentAccount(sql: postgres.Sql, audit: AuditTrail, staff: Staff, accountId: string, input: unknown): Promise<AddAccountResult> {
  return withFailureAudit(audit, staff, spec("payment_account.edited", "edit a Payment account", "payment_account", accountId, "Payment account"), () => edit(sql, audit, staff, accountId, input));
}

async function edit(sql: postgres.Sql, audit: AuditTrail, staff: Staff, accountId: string, input: unknown): Promise<AddAccountResult> {
  if (!canManage(staff)) return { ok: false, reason: "Only a Manager can edit a Payment account." };
  const before = await find(sql, accountId);
  if (!before) return MISSING;
  const valid = validateAccount({ ...(input && typeof input === "object" ? input : {}), method: before.method });
  if (!valid.ok) return valid;
  const a = valid.account;
  const clash = await sql`
    update crms.payment_accounts set label = ${a.label}, account_name = ${a.accountName}, account_number = ${a.accountNumber},
      number_normalised = ${a.numberNormalised}, bank_name = ${a.bankName}
    where id::text = ${accountId} and not exists (
      select 1 from crms.payment_accounts o where o.method = ${a.method} and o.number_normalised = ${a.numberNormalised} and o.id::text <> ${accountId})
    returning id`.catch((e: { code?: string }) => (e?.code === "23505" ? [] : Promise.reject(e)));
  if (clash.length === 0) return { ok: false, reason: `A ${methodLabel(a.method)} account with that number already exists.` };
  await recordAudit(audit, {
    module: MANAGEMENT_MODULE, action: "payment_account.edited", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "payment_account", id: accountId, display_name: a.label },
    description: `${staff.name} edited the ${methodLabel(a.method)} Payment account “${a.label}” (${maskNumber(before.account_number)} → ${maskNumber(a.numberNormalised)}).`,
    occurred_at: new Date().toISOString(), metadata: { method: a.method, bank_name: a.bankName, old_number_last4: before.account_number.replace(/\D/g, "").slice(-4), number_last4: a.numberNormalised.slice(-4) },
    operationId: `payment-account-edited:${accountId}:${staff.id}:${fingerprint(a)}:${minuteOf(new Date())}`,
  });
  return { ok: true };
}

/** Switches an account off or on without deleting it. Switching off the last active account of an enabled method is refused. */
export function setPaymentAccountActive(sql: postgres.Sql, audit: AuditTrail, staff: Staff, accountId: string, active: boolean): Promise<AddAccountResult> {
  const action = active ? "payment_account.activated" : "payment_account.deactivated";
  return withFailureAudit(audit, staff, spec(action, "switch a Payment account on or off", "payment_account", accountId, "Payment account"), () => switchActive(sql, audit, staff, accountId, active));
}

async function switchActive(sql: postgres.Sql, audit: AuditTrail, staff: Staff, accountId: string, active: boolean): Promise<AddAccountResult> {
  if (!canManage(staff)) return { ok: false, reason: "Only a Manager can switch a Payment account on or off." };
  const done = await sql.begin(async (tx) => {
    const [row] = await tx<Found[]>`
      select label, method, active, account_number, bank_name, first_used_at from crms.payment_accounts where id::text = ${accountId} for update`;
    if (!row) return MISSING;
    if (row.active === active) return { ok: true as const, changed: false, row };
    if (!active) {
      // Lock the method's accounts so two switch-offs at once cannot both pass the check.
      await tx`select 1 from crms.payment_accounts where method = ${row.method} for update`;
      const [m] = await tx<{ enabled: boolean }[]>`select enabled from crms.payment_methods where method = ${row.method}`;
      const [others] = await tx<{ n: number }[]>`select count(*)::int as n from crms.payment_accounts where method = ${row.method} and active and id::text <> ${accountId}`;
      if ((m?.enabled ?? true) && others.n === 0) {
        return { ok: false as const, reason: `This is the last active ${methodLabel(row.method)} account. Add another one or disable ${methodLabel(row.method)} first.` };
      }
    }
    await tx`update crms.payment_accounts set active = ${active} where id::text = ${accountId}`;
    return { ok: true as const, changed: true, row };
  });
  if (!done.ok || !("changed" in done) || !done.changed) return done.ok ? { ok: true } : done;
  const { row } = done;
  await recordAudit(audit, {
    module: MANAGEMENT_MODULE, action: active ? "payment_account.activated" : "payment_account.deactivated", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "payment_account", id: accountId, display_name: row.label },
    description: `${staff.name} switched ${active ? "on" : "off"} the ${methodLabel(row.method)} Payment account “${row.label}” (${maskNumber(row.account_number)}).`,
    occurred_at: new Date().toISOString(), metadata: { method: row.method, active, number_last4: row.account_number.replace(/\D/g, "").slice(-4) },
    operationId: `payment-account-active:${accountId}:${active}:${staff.id}:${minuteOf(new Date())}`,
  });
  return { ok: true };
}

/** Disables or re-enables a whole method. A method cannot come back on without an active account to receive money. */
export function setPaymentMethodEnabled(sql: postgres.Sql, audit: AuditTrail, staff: Staff, method: string, enabled: boolean): Promise<AddAccountResult> {
  const action = enabled ? "payment_method.enabled" : "payment_method.disabled";
  return withFailureAudit(audit, staff, spec(action, "enable or disable a payment method", "payment_method", method, methodLabel(method)), () => switchMethod(sql, audit, staff, method, enabled));
}

async function switchMethod(sql: postgres.Sql, audit: AuditTrail, staff: Staff, method: string, enabled: boolean): Promise<AddAccountResult> {
  if (!canManage(staff)) return { ok: false, reason: "Only a Manager can enable or disable a payment method." };
  if (!PAYMENT_METHODS.some((m) => m.value === method)) return { ok: false, reason: "Choose GCash, Maya or Bank transfer." };
  if (enabled) {
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from crms.payment_accounts where method = ${method} and active`;
    if (n.n === 0) return { ok: false, reason: `${methodLabel(method)} has no active account. Add or switch on an account first.` };
  }
  const [prev] = await sql<{ enabled: boolean }[]>`select enabled from crms.payment_methods where method = ${method}`;
  if ((prev?.enabled ?? true) === enabled) return { ok: true };
  await sql`
    insert into crms.payment_methods (method, enabled) values (${method}, ${enabled})
    on conflict (method) do update set enabled = excluded.enabled, updated_at = now()`;
  await recordAudit(audit, {
    module: MANAGEMENT_MODULE, action: enabled ? "payment_method.enabled" : "payment_method.disabled", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "payment_method", id: method, display_name: methodLabel(method) },
    description: `${staff.name} ${enabled ? "enabled" : "disabled"} ${methodLabel(method)} as a payment method.`,
    occurred_at: new Date().toISOString(), metadata: { method, enabled },
    operationId: `payment-method:${method}:${enabled}:${staff.id}:${minuteOf(new Date())}`,
  });
  return { ok: true };
}

/** Deletes an account nobody has used. Once a Customer has seen or used it, it can only be switched off, so history stays whole. */
export function deletePaymentAccount(sql: postgres.Sql, audit: AuditTrail, files: Pick<QrFiles, "remove">, staff: Staff, accountId: string): Promise<AddAccountResult> {
  return withFailureAudit(audit, staff, spec("payment_account.deleted", "delete a Payment account", "payment_account", accountId, "Payment account"), () => remove(sql, audit, files, staff, accountId));
}

async function remove(sql: postgres.Sql, audit: AuditTrail, files: Pick<QrFiles, "remove">, staff: Staff, accountId: string): Promise<AddAccountResult> {
  if (!canManage(staff)) return { ok: false, reason: "Only a Manager can delete a Payment account." };
  const [row] = await sql<(Found & { qr_file_id: string | null })[]>`
    delete from crms.payment_accounts where id::text = ${accountId} and first_used_at is null
    returning label, method, active, account_number, bank_name, first_used_at, qr_file_id`;
  if (!row) {
    return (await find(sql, accountId)) ? { ok: false, reason: "This account has been used, so it cannot be deleted. Switch it off instead." } : MISSING;
  }
  await recordAudit(audit, {
    module: MANAGEMENT_MODULE, action: "payment_account.deleted", outcome: "success", actor: staffAuditActor(staff),
    target: { type: "payment_account", id: accountId, display_name: row.label },
    description: `${staff.name} deleted the unused ${methodLabel(row.method)} Payment account “${row.label}” (${maskNumber(row.account_number)}).`,
    occurred_at: new Date().toISOString(), metadata: { method: row.method, number_last4: row.account_number.replace(/\D/g, "").slice(-4) },
    operationId: `payment-account-deleted:${accountId}`,
  });
  if (row.qr_file_id) await files.remove(row.qr_file_id).catch(() => {});
  return { ok: true };
}
