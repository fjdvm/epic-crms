import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { changePaymentWindow, loadPaymentWindow } from "@/features/management/payment-window";
import { parseWindowHours } from "@/features/management/payment-window-format";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

describe("parseWindowHours", () => {
  it.each([["24", 24], [" 48 ", 48], [1, 1], ["720", 720]])("accepts %j", (input, hours) => {
    expect(parseWindowHours(input)).toEqual({ ok: true, hours });
  });
  it.each(["", "  ", "abc", "-5", "1.5", "0", "721", "12345", null, undefined, {}])("refuses %j in plain words", (input) => {
    const r = parseWindowHours(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/[A-Za-z]/);
  });
});

describe("changePaymentWindow", () => {
  let db: TestDatabase;
  const audit = vi.fn(async () => {});
  beforeAll(async () => {
    db = await startTestDatabase();
    await db.sql`create schema crms`;
    await db.sql.unsafe(readFileSync("docs/db/crms-payment-window.sql", "utf8"));
  }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    audit.mockClear();
    await db.sql`update crms.payment_window_settings set hours = 24`;
  });

  it("defaults to 24 hours", async () => {
    expect(await loadPaymentWindow(db.sql)).toBe(24);
  });

  it.each(["Staff/Employee", "Super Admin"])("refuses %s on the server and writes nothing", async (role) => {
    const r = await changePaymentWindow(db.sql, audit, { id: "x", name: "X", role }, "48");
    expect(r).toEqual({ ok: false, reason: "Only a Manager or the CEO can change the payment window." });
    expect(await loadPaymentWindow(db.sql)).toBe(24);
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses invalid hours without saving or auditing", async () => {
    const r = await changePaymentWindow(db.sql, audit, { id: "m", name: "Mario", role: "CRMS Manager" }, "0");
    expect(r.ok).toBe(false);
    expect(await loadPaymentWindow(db.sql)).toBe(24);
    expect(audit).not.toHaveBeenCalled();
  });

  it.each(["CRMS Manager", "CEO"])("saves for %s and audits old and new value under their name", async (role) => {
    const r = await changePaymentWindow(db.sql, audit, { id: "m", name: "Mario", role }, "48");
    expect(r).toEqual({ ok: true, hours: 48 });
    expect(await loadPaymentWindow(db.sql)).toBe(48);
    expect(audit).toHaveBeenCalledTimes(1);
    const event = (audit.mock.calls[0] as unknown as [import("@/lib/audit-trail").AuditEvent])[0];
    expect(event).toMatchObject({
      action: "payment_window.changed", outcome: "success", actor: { id: "m", display_name: "Mario" },
      metadata: { previous: 24, next: 48 },
    });
    expect(event.description).toBe("Mario changed the payment window from 24 hours to 48 hours.");
  });
});
