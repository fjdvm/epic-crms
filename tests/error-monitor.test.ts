import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditEvent } from "@/lib/audit-trail";
import { reportError, type ErrorMonitorPorts } from "@/lib/error-monitor";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const audit = vi.fn(async (_event: AuditEvent) => {});
const email = vi.fn(async (_email: Parameters<ErrorMonitorPorts["email"]>[0]) => {});
let clock = new Date("2026-11-16T08:00:00Z");

const ports = (over: Partial<ErrorMonitorPorts> = {}): ErrorMonitorPorts => ({
  sql: db.sql, audit, email, ownerEmail: "owner@example.com", appUrl: "https://creoms.example.com", now: () => clock, ...over,
});

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-error-alerts.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate crms.error_alerts`;
  audit.mockClear(); email.mockClear();
  clock = new Date("2026-11-16T08:00:00Z");
});

describe("error monitoring", () => {
  it("records a system.error Audit Event and emails the owner", async () => {
    await reportError("cron:feedback-analysis", new Error("model down"), ports());

    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0][0]).toMatchObject({ action: "system.error", outcome: "failure", target: { id: "cron:feedback-analysis" } });
    expect(email).toHaveBeenCalledOnce();
    expect(email.mock.calls[0][0]).toMatchObject({ to: "owner@example.com", title: "CREOMS error: cron:feedback-analysis" });
    expect(email.mock.calls[0][0].body).toContain("model down");
  });

  it("emails once per kind per hour but records every error", async () => {
    await reportError("a", new Error("1"), ports());
    clock = new Date("2026-11-16T08:30:00Z");
    await reportError("a", new Error("2"), ports());
    await reportError("b", new Error("3"), ports());

    expect(audit).toHaveBeenCalledTimes(3);
    expect(email.mock.calls.map((c) => c[0].title)).toEqual(["CREOMS error: a", "CREOMS error: b"]);

    clock = new Date("2026-11-16T09:00:00Z");
    await reportError("a", new Error("4"), ports());

    expect(email).toHaveBeenCalledTimes(3);
  });

  it("emails once when the same kind fails concurrently", async () => {
    await Promise.all([1, 2, 3].map((n) => reportError("a", new Error(String(n)), ports())));

    expect(email).toHaveBeenCalledOnce();
  });

  it("still records the error when no owner email is set", async () => {
    await reportError("a", new Error("x"), ports({ ownerEmail: undefined }));

    expect(audit).toHaveBeenCalledOnce();
    expect(email).not.toHaveBeenCalled();
  });

  it("never throws when the audit, the database or the email fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(reportError("a", new Error("x"), ports({ audit: async () => { throw new Error("audit down"); } }))).resolves.toBeUndefined();
    await expect(reportError("b", new Error("x"), ports({ email: async () => { throw new Error("mail down"); } }))).resolves.toBeUndefined();
    await expect(reportError("c", "plain", ports({ sql: (() => { throw new Error("db down"); }) as never }))).resolves.toBeUndefined();
  });
});
