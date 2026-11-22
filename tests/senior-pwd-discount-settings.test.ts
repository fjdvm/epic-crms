import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseDiscount, describeDiscount } from "@/features/management/senior-pwd-discount-format";
import { changeSeniorPwdDiscount, loadSeniorPwdDiscount } from "@/features/management/senior-pwd-discount";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const input = (o: Record<string, unknown> = {}) => ({ kind: "percent", amount: "5", limit: "1500", per: "week", ...o });

describe("parseDiscount", () => {
  it("reads a percentage with a limit per period", () => {
    expect(parseDiscount(input())).toEqual({ ok: true, discount: { kind: "percent", hundredths: 500, limitInCentavos: 150000, per: "week" } });
  });
  it("reads a peso discount, with commas and the peso sign", () => {
    expect(parseDiscount(input({ kind: "pesos", amount: "₱125.50", limit: "1,500", per: "month" })))
      .toEqual({ ok: true, discount: { kind: "pesos", hundredths: 12550, limitInCentavos: 150000, per: "month" } });
  });
  it.each([
    [{ kind: "euros" }], [{ per: "year" }], [{ amount: "" }], [{ amount: "abc" }], [{ amount: "0" }], [{ amount: "100.01" }],
    [{ amount: "5.555" }], [{ limit: "" }], [{ limit: "0" }], [{ limit: "1000000.01" }], [{ kind: "pesos", amount: "2000", limit: "1500" }], [null],
  ])("refuses %j in plain words", (o) => {
    const r = parseDiscount(o === null ? null : input(o));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/[A-Za-z]/);
  });
  it("says it in words", () => {
    expect(describeDiscount({ kind: "percent", hundredths: 500, limitInCentavos: 150000, per: "week" })).toBe("5% off, up to ₱1,500 per week");
    expect(describeDiscount({ kind: "pesos", hundredths: 12550, limitInCentavos: 150000, per: "day" })).toBe("₱125.50 off, up to ₱1,500 per day");
  });
});

describe("changeSeniorPwdDiscount", () => {
  let db: TestDatabase;
  const audit = vi.fn(async () => {});
  const manager = { id: "m", name: "Mario", role: "CRMS Manager" };
  beforeAll(async () => {
    db = await startTestDatabase();
    await db.sql`create schema crms`;
    await db.sql.unsafe(readFileSync("docs/db/crms-senior-pwd-discount.sql", "utf8"));
    await db.sql.unsafe(readFileSync("docs/db/crms-senior-pwd-discount.sql", "utf8")); // safe to re-run
  }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    audit.mockClear();
    await db.sql`update crms.senior_pwd_discount_settings set discount_kind = 'percent', discount_hundredths = 500, limit_in_centavos = 12500, limit_per = 'week'`;
  });

  it("starts at today's rule: 5% off, up to ₱125 per week", async () => {
    expect(await loadSeniorPwdDiscount(db.sql)).toEqual({ kind: "percent", hundredths: 500, limitInCentavos: 12500, per: "week" });
  });

  it.each(["Staff/Employee", "Super Admin"])("refuses %s on the server and writes nothing", async (role) => {
    const r = await changeSeniorPwdDiscount(db.sql, audit, { id: "x", name: "X", role }, input());
    expect(r).toEqual({ ok: false, reason: "Only a Manager or the CEO can change the Senior/PWD discount." });
    expect((await loadSeniorPwdDiscount(db.sql))?.limitInCentavos).toBe(12500);
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses an invalid change without saving or auditing", async () => {
    expect((await changeSeniorPwdDiscount(db.sql, audit, manager, input({ amount: "0" }))).ok).toBe(false);
    expect((await loadSeniorPwdDiscount(db.sql))?.hundredths).toBe(500);
    expect(audit).not.toHaveBeenCalled();
  });

  it.each(["CRMS Manager", "CEO"])("saves for %s and audits the old and new rule under their name", async (role) => {
    const r = await changeSeniorPwdDiscount(db.sql, audit, { ...manager, role }, input({ kind: "pesos", amount: "100", limit: "1500", per: "month" }));
    expect(r).toEqual({ ok: true, discount: { kind: "pesos", hundredths: 10000, limitInCentavos: 150000, per: "month" } });
    expect(await loadSeniorPwdDiscount(db.sql)).toEqual({ kind: "pesos", hundredths: 10000, limitInCentavos: 150000, per: "month" });
    expect(audit).toHaveBeenCalledTimes(1);
    const event = (audit.mock.calls[0] as unknown as [import("@/lib/audit-trail").AuditEvent])[0];
    expect(event).toMatchObject({ action: "senior_pwd_discount.changed", outcome: "success", actor: { id: "m", display_name: "Mario" } });
    expect(event.description).toBe("Mario changed the Senior/PWD discount from 5% off, up to ₱125 per week to ₱100 off, up to ₱1,500 per month.");
  });
});
