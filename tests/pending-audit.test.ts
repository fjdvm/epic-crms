import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEvent } from "@/lib/audit-trail";
import { deliverPendingAudits, savePendingAudit } from "@/lib/pending-audit";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  module: "Payments", action: "payment.approved_anyway", outcome: "success",
  actor: { type: "user", id: "mario", display_name: "Mario" },
  target: { type: "order", id: "7", display_name: "Order #7" },
  description: "Mario approved Order #7 anyway: checked", occurred_at: "2026-11-25T10:00:00.000Z",
  metadata: { reason: "checked" }, operationId: "order:7:payment.approved_anyway", ...over,
});
const rows = () => db.sql<{ state: string; attempts: number; last_error: string | null }[]>`select state, attempts, last_error from crms.pending_audit_records order by created_at`;

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-pending-audit.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-pending-audit.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.sql`truncate crms.pending_audit_records`; await db.sql`drop table if exists crms.some_action`; await db.sql`create table crms.some_action (id int)`; });

describe("pending audit record", () => {
  it("commits with the action's own write, and rolls back with it", async () => {
    await db.sql.begin(async tx => { await tx`insert into crms.some_action values (1)`; await savePendingAudit(tx, event()); });
    expect(await rows()).toHaveLength(1);
    await expect(db.sql.begin(async tx => { await tx`insert into crms.some_action values (2)`; await savePendingAudit(tx, event({ operationId: "other" })); throw new Error("action failed"); })).rejects.toThrow();
    expect(await rows()).toHaveLength(1);
    expect(await db.sql`select id from crms.some_action`).toEqual([{ id: 1 }]);
  });

  it("delivers the saved event once and never again", async () => {
    await savePendingAudit(db.sql, event());
    const deliver = vi.fn(async (_e: AuditEvent) => {});
    expect(await deliverPendingAudits(db.sql, deliver)).toEqual({ delivered: 1, failed: 0 });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0]).toEqual(event());
    expect(await deliverPendingAudits(db.sql, deliver)).toEqual({ delivered: 0, failed: 0 });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(await rows()).toEqual([{ state: "delivered", attempts: 1, last_error: null }]);
  });

  it("keeps one record for a replayed action", async () => {
    await savePendingAudit(db.sql, event());
    await savePendingAudit(db.sql, event({ description: "replay, worded differently" }));
    expect(await rows()).toHaveLength(1);
    const deliver = vi.fn(async (_e: AuditEvent) => {});
    await deliverPendingAudits(db.sql, deliver);
    expect(deliver.mock.calls[0][0].description).toBe(event().description);
  });

  it("stays pending when delivery fails, without throwing, and a retry delivers it", async () => {
    await savePendingAudit(db.sql, event());
    const down = vi.fn(async (_e: AuditEvent) => { throw new Error("The gateway refused the audit event: 503"); });
    expect(await deliverPendingAudits(db.sql, down)).toEqual({ delivered: 0, failed: 1 });
    expect(await rows()).toEqual([{ state: "pending", attempts: 1, last_error: "The gateway refused the audit event: 503" }]);
    const up = vi.fn(async (_e: AuditEvent) => {});
    expect(await deliverPendingAudits(db.sql, up)).toEqual({ delivered: 1, failed: 0 });
    // The retry sends the original event, so the gateway's idempotency key matches the first attempt.
    expect(up.mock.calls[0][0]).toEqual(event());
    expect(await rows()).toEqual([{ state: "delivered", attempts: 2, last_error: null }]);
  });

  it("lets concurrent deliveries send a record once", async () => {
    await savePendingAudit(db.sql, event());
    const deliver = vi.fn(async (_e: AuditEvent) => { await new Promise(r => setTimeout(r, 30)); });
    await Promise.all([deliverPendingAudits(db.sql, deliver), deliverPendingAudits(db.sql, deliver)]);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("can deliver just one record by its operation", async () => {
    await savePendingAudit(db.sql, event());
    await savePendingAudit(db.sql, event({ operationId: "order:8:payment.approved_anyway", target: { type: "order", id: "8", display_name: "Order #8" } }));
    const deliver = vi.fn(async (_e: AuditEvent) => {});
    await deliverPendingAudits(db.sql, deliver, { only: event() });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0].target.id).toBe("7");
  });
});
