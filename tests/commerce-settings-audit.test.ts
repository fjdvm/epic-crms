import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { changeFreeDeliveryThreshold } from "@/features/management/free-delivery-threshold";
import { addPaymentAccount, deletePaymentAccount, editPaymentAccount, setPaymentAccountActive, setPaymentAccountQr, setPaymentMethodEnabled } from "@/features/management/payment-accounts";
import { changePaymentWindow } from "@/features/management/payment-window";
import { changeSeniorPwdDiscount } from "@/features/management/senior-pwd-discount";
import { DEFAULT_AUTOMATIC_CHECKS } from "@/features/settings/automatic-checks";
import { saveAutomaticChecks } from "@/features/settings/automatic-checks-server";
import { setServiceTargets } from "@/features/tickets/service-level-store";
import { auditEvents } from "./settings-audit-helpers";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

// Commerce Settings audit (#753): refusals, failures and replays, read through the AuditTrail port.
const audit = vi.fn(async () => {});
const staff = { id: "s1", name: "Sam", role: "Staff/Employee" };
const manager = { id: "m1", name: "Mia", role: "CREOMS Manager" };
const files = { claim: async () => null, remove: async () => {} };
const throwingSql = (() => { throw new Error("db down"); }) as never;

const attempts: [string, string, (who: typeof staff, sql?: never) => Promise<unknown>][] = [
  ["free_delivery_threshold.changed", "free-delivery-threshold", (w, s) => changeFreeDeliveryThreshold(s as never, audit, w, "3000")],
  ["payment_window.changed", "payment-window", (w, s) => changePaymentWindow(s as never, audit, w, "48")],
  ["senior_pwd_discount.changed", "senior-pwd-discount", (w, s) => changeSeniorPwdDiscount(s as never, audit, w, { kind: "percent", amount: "5", limit: "500", per: "day" })],
  ["automatic_checks.changed", "automatic-checks", (w, s) => saveAutomaticChecks(s as never, audit, w, DEFAULT_AUTOMATIC_CHECKS)],
  ["service_levels.changed", "service-levels", (w, s) => setServiceTargets(s as never, audit, w, { firstReplyHours: 2, resolveHours: 6 })],
  ["payment_account.added", "new", (w, s) => addPaymentAccount(s as never, audit, w, { method: "gcash", label: "Main", accountName: "Bren", accountNumber: "09171234567" })],
  ["payment_account.edited", "acc-1", (w, s) => editPaymentAccount(s as never, audit, w, "acc-1", {})],
  ["payment_account.deactivated", "acc-1", (w, s) => setPaymentAccountActive(s as never, audit, w, "acc-1", false)],
  ["payment_method.disabled", "gcash", (w, s) => setPaymentMethodEnabled(s as never, audit, w, "gcash", false)],
  ["payment_account.deleted", "acc-1", (w, s) => deletePaymentAccount(s as never, audit, files, w, "acc-1")],
  ["payment_account.qr_removed", "acc-1", (w, s) => setPaymentAccountQr(s as never, audit, files, { ...w, username: "sam" }, "acc-1", null)],
];

beforeEach(() => { audit.mockClear(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe.each(attempts)("%s", (action, targetId, attempt) => {
  it("records the denied attempt of Staff once, with no personal data, and once per replay", async () => {
    expect(await attempt(staff, throwingSql)).toMatchObject({ ok: false });
    await attempt(staff, throwingSql);
    const [first, second] = auditEvents(audit);
    expect(first).toMatchObject({
      action, outcome: "failure", actor: { type: "user", id: "s1", display_name: "Sam" }, target: { id: targetId },
      metadata: { setting: targetId, reason: expect.stringMatching(/^Only a Manager/) },
    });
    expect(first.operationId).toBe(second.operationId);
  });

  it("records a failure when the save throws, and still throws", async () => {
    await expect(attempt(manager, throwingSql)).rejects.toThrow();
    expect(auditEvents(audit).at(-1)).toMatchObject({ action, outcome: "failure", metadata: { reason: "unavailable" } });
  });
});

describe("a validation failure keeps what was typed out of the event", () => {
  it("records only the fixed reason for a bad account number", async () => {
    const r = await addPaymentAccount(throwingSql, audit, manager, { method: "gcash", label: "Main", accountName: "Bren", accountNumber: "0917-bad" });
    expect(r.ok).toBe(false);
    const [event] = auditEvents(audit);
    expect(event).toMatchObject({ action: "payment_account.added", outcome: "failure" });
    expect(JSON.stringify(event)).not.toMatch(/0917|Bren/);
  });
});

describe("a replayed change records one success identity", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await startTestDatabase();
    await db.sql`create schema crms`;
    await db.sql.unsafe(readFileSync("docs/db/crms-delivery-settings.sql", "utf8"));
    await db.sql.unsafe(readFileSync("docs/db/crms-payment-window.sql", "utf8"));
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("gives a replayed payment window save the same operation identity, and a different value another", async () => {
    await changePaymentWindow(db.sql, audit, manager, "48");
    await changePaymentWindow(db.sql, audit, manager, "48");
    await changePaymentWindow(db.sql, audit, manager, "72");
    const [a, b, c] = auditEvents(audit);
    expect(a).toMatchObject({ action: "payment_window.changed", outcome: "success", metadata: { previous: 24, next: 48 } });
    expect(a.operationId).toBe(b.operationId);
    expect(c.operationId).not.toBe(a.operationId);
  });
});
