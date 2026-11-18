import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { changeFreeDeliveryThreshold, loadFreeDeliveryThreshold } from "@/features/management/free-delivery-threshold";
import { parseThreshold } from "@/features/management/threshold-format";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

describe("parseThreshold", () => {
  it.each([["2500", 250000], ["₱2,500", 250000], [" 2,500.5 ", 250050], [1000, 100000], ["0.01", 1]])("accepts %s", (input, centavos) => {
    expect(parseThreshold(input)).toEqual({ ok: true, thresholdInCentavos: centavos });
  });
  it.each(["", "  ", "abc", "-5", "1e3", "12,34", "2500.999", "0", "0.00", "1000000.01", null, undefined, {}])("refuses %j in plain words", (input) => {
    const r = parseThreshold(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/[A-Za-z]/);
  });
});

describe("changeFreeDeliveryThreshold", () => {
  let db: TestDatabase;
  const audit = vi.fn(async () => {});
  beforeAll(async () => {
    db = await startTestDatabase();
    await db.sql`create schema crms`;
    await db.sql.unsafe(readFileSync("docs/db/crms-delivery-settings.sql", "utf8"));
  }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    audit.mockClear();
    await db.sql`update crms.delivery_settings set free_delivery_threshold_in_centavos = 250000`;
  });

  it.each(["Staff/Employee", "Super Admin"])("refuses %s on the server and writes nothing", async (role) => {
    const r = await changeFreeDeliveryThreshold(db.sql, audit, { id: "x", name: "X", role }, "3000");
    expect(r).toEqual({ ok: false, reason: "Only a Manager or the CEO can change the Free delivery threshold." });
    expect(await loadFreeDeliveryThreshold(db.sql)).toBe(250000);
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses an invalid amount without saving or auditing", async () => {
    const r = await changeFreeDeliveryThreshold(db.sql, audit, { id: "m", name: "Mario", role: "CRMS Manager" }, "0");
    expect(r.ok).toBe(false);
    expect(await loadFreeDeliveryThreshold(db.sql)).toBe(250000);
    expect(audit).not.toHaveBeenCalled();
  });

  it.each(["CRMS Manager", "CEO"])("saves for %s and audits old and new value under their name", async (role) => {
    const r = await changeFreeDeliveryThreshold(db.sql, audit, { id: "m", name: "Mario", role }, "3,000");
    expect(r).toEqual({ ok: true, thresholdInCentavos: 300000 });
    expect(await loadFreeDeliveryThreshold(db.sql)).toBe(300000);
    expect(audit).toHaveBeenCalledTimes(1);
    const event = (audit.mock.calls[0] as unknown as [import("@/lib/audit-trail").AuditEvent])[0];
    expect(event).toMatchObject({
      action: "free_delivery_threshold.changed", outcome: "success", actor: { id: "m", display_name: "Mario" },
      metadata: { previous: 250000, next: 300000 },
    });
    expect(event.description).toBe("Mario changed the Free delivery threshold from ₱2,500 to ₱3,000.");
  });
});
