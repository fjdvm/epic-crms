import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addPaymentAccount, deletePaymentAccount, editPaymentAccount, listDisabledMethods, listMethodAvailability, listPaymentAccounts, setPaymentAccountActive, setPaymentMethodEnabled,
} from "@/features/management/payment-accounts";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const gcash = { method: "gcash", label: "Main GCash", accountName: "Bren", accountNumber: "0917 123 4567", bankName: "" };
const gcash2 = { ...gcash, label: "Second", accountNumber: "0918 555 1212" };

describe("Payment account lifecycle", () => {
  let db: TestDatabase;
  const audit = vi.fn(async () => {});
  const manager = { id: "m", name: "Mario", role: "CRMS Manager" };
  const events = () => audit.mock.calls.map((c) => (c as unknown as [import("@/lib/audit-trail").AuditEvent])[0]);
  // Ordered by label, not creation time: two accounts added in one millisecond tie on created_at and come back in random order.
  const ids = async () => (await listPaymentAccounts(db.sql)).sort((x, y) => x.label.localeCompare(y.label)).map((a) => a.id);
  const files = { remove: vi.fn(async () => {}) };

  beforeAll(async () => {
    db = await startTestDatabase();
    await db.sql`create schema crms`;
    await db.sql.unsafe(readFileSync("docs/db/crms-payment-accounts.sql", "utf8"));
  }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    audit.mockClear();
    await db.sql`truncate crms.payment_accounts, crms.payment_methods`;
    await addPaymentAccount(db.sql, audit, manager, gcash);
    await addPaymentAccount(db.sql, audit, manager, gcash2);
    audit.mockClear();
  });

  it("refuses every change for Staff and writes nothing", async () => {
    const [a] = await ids();
    const staff = { ...manager, role: "Staff/Employee" };
    for (const r of [
      await editPaymentAccount(db.sql, audit, staff, a, gcash),
      await setPaymentAccountActive(db.sql, audit, staff, a, false),
      await setPaymentMethodEnabled(db.sql, audit, staff, "gcash", false),
      await deletePaymentAccount(db.sql, audit, files, staff, a),
    ]) expect(r.ok).toBe(false);
    expect(await ids()).toHaveLength(2);
    expect((await listPaymentAccounts(db.sql)).every((x) => x.active)).toBe(true);
    expect(audit).not.toHaveBeenCalled();
  });

  it("edits details, keeps the method, and audits only masked numbers", async () => {
    const [a] = await ids();
    expect(await editPaymentAccount(db.sql, audit, manager, a, { ...gcash, method: "maya", label: "Renamed", accountNumber: "0919 777 8888" })).toEqual({ ok: true });
    const row = (await listPaymentAccounts(db.sql)).find((x) => x.id === a)!;
    expect(row).toMatchObject({ method: "gcash", label: "Renamed", maskedNumber: "•••••••8888" });
    expect(events()[0]).toMatchObject({ action: "payment_account.edited", metadata: { number_last4: "8888", old_number_last4: "4567" } });
    // Any more than the last four digits of either number, in any spacing. Not bare "777": the events also carry random
    // UUIDs and millisecond timestamps, which can hold it by chance.
    expect(JSON.stringify(events())).not.toMatch(/0\D?9\D?1\D?7\D?1\D?2\D?3|0\D?9\D?1\D?9\D?7\D?7\D?7/);
  });

  it("refuses an edit that duplicates another account or is invalid", async () => {
    const [a] = await ids();
    expect(await editPaymentAccount(db.sql, audit, manager, a, { ...gcash, accountNumber: "0918-555-1212" })).toEqual({ ok: false, reason: "A GCash account with that number already exists." });
    expect((await editPaymentAccount(db.sql, audit, manager, a, { ...gcash, accountNumber: "1" })).ok).toBe(false);
    expect(await editPaymentAccount(db.sql, audit, manager, a, gcash)).toEqual({ ok: true });
    expect((await editPaymentAccount(db.sql, audit, manager, "00000000-0000-0000-0000-000000000000", gcash)).ok).toBe(false);
  });

  it("deactivates and reactivates while keeping the account, but refuses the last active one of an enabled method", async () => {
    const [a, b] = await ids();
    expect(await setPaymentAccountActive(db.sql, audit, manager, a, false)).toEqual({ ok: true });
    expect((await listPaymentAccounts(db.sql)).find((x) => x.id === a)?.active).toBe(false);
    const refused = await setPaymentAccountActive(db.sql, audit, manager, b, false);
    expect(refused).toEqual({ ok: false, reason: expect.stringContaining("last active GCash account") });
    expect((await listPaymentAccounts(db.sql)).find((x) => x.id === b)?.active).toBe(true);
    expect(events().map((e) => e.action)).toEqual(["payment_account.deactivated"]);
    expect(await setPaymentAccountActive(db.sql, audit, manager, a, true)).toEqual({ ok: true });
    expect(events().at(-1)).toMatchObject({ action: "payment_account.activated", metadata: { number_last4: "4567" } });
  });

  it("lets two switch-offs at once leave one account active", async () => {
    const [a, b] = await ids();
    await Promise.all([setPaymentAccountActive(db.sql, audit, manager, a, false), setPaymentAccountActive(db.sql, audit, manager, b, false)]);
    expect((await listPaymentAccounts(db.sql)).filter((x) => x.active)).toHaveLength(1);
  });

  it("allows switching off the last account once the method is disabled", async () => {
    const [a, b] = await ids();
    expect(await setPaymentMethodEnabled(db.sql, audit, manager, "gcash", false)).toEqual({ ok: true });
    expect(await listDisabledMethods(db.sql)).toEqual(["gcash"]);
    expect(await setPaymentAccountActive(db.sql, audit, manager, a, false)).toEqual({ ok: true });
    expect(await setPaymentAccountActive(db.sql, audit, manager, b, false)).toEqual({ ok: true });
    expect(await setPaymentMethodEnabled(db.sql, audit, manager, "gcash", true)).toEqual({ ok: false, reason: expect.stringContaining("no active account") });
    await setPaymentAccountActive(db.sql, audit, manager, a, true);
    expect(await setPaymentMethodEnabled(db.sql, audit, manager, "gcash", true)).toEqual({ ok: true });
    expect(await listDisabledMethods(db.sql)).toEqual([]);
    expect(events().filter((e) => e.action.startsWith("payment_method")).map((e) => e.action)).toEqual(["payment_method.disabled", "payment_method.enabled"]);
  });

  it("refuses an unknown method", async () => {
    expect((await setPaymentMethodEnabled(db.sql, audit, manager, "paypal", false)).ok).toBe(false);
  });

  it("deletes an unused account but never a used one", async () => {
    const [a, b] = await ids();
    await db.sql`update crms.payment_accounts set first_used_at = now() where id = ${a}`;
    expect(await deletePaymentAccount(db.sql, audit, files, manager, a)).toEqual({ ok: false, reason: expect.stringContaining("has been used") });
    expect(await ids()).toHaveLength(2);
    expect(audit).not.toHaveBeenCalled();
    expect(await deletePaymentAccount(db.sql, audit, files, manager, b)).toEqual({ ok: true });
    expect(await ids()).toEqual([a]);
    expect(events()[0]).toMatchObject({ action: "payment_account.deleted", metadata: { number_last4: "1212" } });
    expect(JSON.stringify(events())).not.toMatch(/0918|555/);
    expect((await deletePaymentAccount(db.sql, audit, files, manager, b)).ok).toBe(false);
  });
  it("reports a method available only when it is enabled and has an active account", async () => {
    const [a, b] = await ids();
    expect(await listMethodAvailability(db.sql)).toEqual({ gcash: true, maya: false, bank_transfer: false });
    await setPaymentAccountActive(db.sql, audit, manager, a, false);
    expect((await listMethodAvailability(db.sql)).gcash).toBe(true);
    await setPaymentMethodEnabled(db.sql, audit, manager, "gcash", false);
    expect((await listMethodAvailability(db.sql)).gcash).toBe(false);
    await setPaymentMethodEnabled(db.sql, audit, manager, "gcash", true);
    expect((await listMethodAvailability(db.sql)).gcash).toBe(true);
    // A method switched off by hand with every account inactive stays unavailable.
    await db.sql`update crms.payment_accounts set active = false where id = ${b}`;
    expect((await listMethodAvailability(db.sql)).gcash).toBe(false);
  });
});
