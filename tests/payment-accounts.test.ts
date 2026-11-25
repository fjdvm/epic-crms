import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { maskNumber, validateAccount } from "@/features/management/payment-account-format";
import { addPaymentAccount, listPaymentAccounts } from "@/features/management/payment-accounts";
import { startTestDatabase, type TestDatabase } from "./ticket-database";
import { expectOnlyFailureEvents } from "./settings-audit-helpers";

const gcash = { method: "gcash", label: "Main GCash", accountName: "Bren Raphael", accountNumber: "0917 123 4567", bankName: "" };
const bank = { method: "bank_transfer", label: "BDO", accountName: "Bren Raphael", accountNumber: "0012-3456-7890", bankName: "BDO" };

describe("validateAccount", () => {
  it("normalises GCash and Maya mobile numbers, keeping leading zeros", () => {
    for (const n of ["0917 123 4567", "+63 917 123 4567", "0917-123-4567", "639171234567"]) {
      const r = validateAccount({ ...gcash, accountNumber: n });
      expect(r).toMatchObject({ ok: true, account: { numberNormalised: "09171234567" } });
    }
  });
  it.each(["12345", "0817 123 4567", "abc", ""])("refuses GCash number %j", (n) => {
    expect(validateAccount({ ...gcash, accountNumber: n }).ok).toBe(false);
  });
  it("needs a bank name and 10 to 16 digits for bank transfer", () => {
    expect(validateAccount(bank)).toMatchObject({ ok: true, account: { numberNormalised: "0012345678 90".replace(" ", ""), bankName: "BDO" } });
    expect(validateAccount({ ...bank, bankName: " " }).ok).toBe(false);
    expect(validateAccount({ ...bank, accountNumber: "123456789" }).ok).toBe(false);
    expect(validateAccount({ ...bank, accountNumber: "12345678901234567" }).ok).toBe(false);
  });
  it("refuses an unknown method, a missing label and a missing name", () => {
    expect(validateAccount({ ...gcash, method: "paypal" }).ok).toBe(false);
    expect(validateAccount({ ...gcash, label: "" }).ok).toBe(false);
    expect(validateAccount({ ...gcash, accountName: "" }).ok).toBe(false);
    expect(validateAccount(null).ok).toBe(false);
  });
  it("masks to the last four digits", () => expect(maskNumber("09171234567")).toBe("•••••••4567"));
});

describe("addPaymentAccount", () => {
  let db: TestDatabase;
  const audit = vi.fn(async () => {});
  const manager = { id: "m", name: "Mario", role: "CRMS Manager" };
  beforeAll(async () => {
    db = await startTestDatabase();
    await db.sql`create schema crms`;
    await db.sql.unsafe(readFileSync("docs/db/crms-payment-accounts.sql", "utf8"));
  }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => { audit.mockClear(); await db.sql`truncate crms.payment_accounts`; });

  it.each(["Staff/Employee", "Super Admin"])("refuses %s on the server and writes nothing", async (role) => {
    const r = await addPaymentAccount(db.sql, audit, { ...manager, role }, gcash);
    expect(r).toEqual({ ok: false, reason: "Only a Manager can add a Payment account." });
    expect(await listPaymentAccounts(db.sql)).toEqual([]);
    expectOnlyFailureEvents(audit);
  });

  it("refuses invalid input without saving or auditing", async () => {
    expect((await addPaymentAccount(db.sql, audit, manager, { ...gcash, accountNumber: "1" })).ok).toBe(false);
    expect(await listPaymentAccounts(db.sql)).toEqual([]);
    expectOnlyFailureEvents(audit);
  });

  it.each(["CRMS Manager", "CEO"])("saves for %s, lists it masked and audits only the last four digits", async (role) => {
    expect(await addPaymentAccount(db.sql, audit, { ...manager, role }, gcash)).toEqual({ ok: true });
    const [row] = await listPaymentAccounts(db.sql);
    expect(row).toMatchObject({ method: "gcash", label: "Main GCash", maskedNumber: "•••••••4567", bankName: null, active: true });
    const [stored] = await db.sql`select account_number from crms.payment_accounts`;
    expect(stored.account_number).toBe("0917 123 4567");
    expect(audit).toHaveBeenCalledTimes(1);
    const event = (audit.mock.calls[0] as unknown as [import("@/lib/audit-trail").AuditEvent])[0];
    expect(event).toMatchObject({ action: "payment_account.added", outcome: "success", actor: { id: "m", display_name: "Mario" }, metadata: { number_last4: "4567" } });
    expect(JSON.stringify(event)).not.toMatch(/0917|1234567|123 4567/);
  });

  it("refuses a duplicate method plus normalised number, however it is typed", async () => {
    await addPaymentAccount(db.sql, audit, manager, gcash);
    audit.mockClear();
    const r = await addPaymentAccount(db.sql, audit, manager, { ...gcash, label: "Other", accountNumber: "+63-917-123-4567" });
    expect(r).toEqual({ ok: false, reason: "A GCash account with that number already exists." });
    expect(await listPaymentAccounts(db.sql)).toHaveLength(1);
    expectOnlyFailureEvents(audit);
  });

  it("allows the same number under another method", async () => {
    await addPaymentAccount(db.sql, audit, manager, gcash);
    expect(await addPaymentAccount(db.sql, audit, manager, { ...gcash, method: "maya" })).toEqual({ ok: true });
  });
});
