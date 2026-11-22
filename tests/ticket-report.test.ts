import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadTicketReport, mayReadTicketReport, parseReportPreset, resolveReportPeriod } from "@/features/reports/ticket-report";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

const NOW = new Date("2026-10-20T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3600_000).toISOString();
const period = { start: new Date(NOW.getTime() - 30 * 86_400_000), end: NOW };

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-service-levels.sql", "utf8"));
  const base = readFileSync("docs/db/crms-schema.sql", "utf8").replace(/^--.*$/gm, "").split(";").map((s) => s.trim())
    .filter((s) => /^create table crms\.notifications|^create unique index notifications_new|^create index notifications_unread/i.test(s));
  for (const statement of base) await db.sql.unsafe(statement);
  await db.sql.unsafe(readFileSync("docs/db/crms-ticket-reassign.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-ticket-escalate.sql", "utf8"));
});
afterAll(async () => db.close());

beforeEach(async () => {
  await db.sql`truncate tickets, customers, crms.ticket_service_misses, crms.ticket_escalations restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Ana Cruz', 'ana@example.com')`;
});

const deps = () => ({ tickets: db.sql, crms: db.sql });
const run = async (role = "Manager") => {
  const result = await loadTicketReport(deps(), { role, period, now: NOW });
  if (!result.ok) throw new Error(result.reason);

  return result.report;
};

async function ticket(over: { category?: string; status?: string; created: string; resolved?: string; claimer?: string; held?: number; rating?: number; comment?: string; ratedAt?: string; followUpOf?: number }) {
  const [t] = await db.sql<{ id: number }[]>`
    insert into tickets (customer_id, subject, category, status, claimed_by_id, claimed_by_name, held_seconds, resolved_at, rating, rating_comment, rated_at, follow_up_of_id, created_at)
    values ('c1', 'Subject', ${over.category ?? "Other"}, ${over.status ?? "open"}, ${over.claimer ?? null}, ${over.claimer ? over.claimer.toUpperCase() : null},
      ${over.held ?? 0}, ${over.resolved ?? null}, ${over.rating ?? null}, ${over.comment ?? null}, ${over.ratedAt ?? null}, ${over.followUpOf ?? null}, ${over.created})
    returning id`;

  return t.id;
}
const message = (id: number, sender: string, at: string, internal = false) =>
  db.sql`insert into ticket_messages (ticket_id, sender, body, internal, created_at) values (${id}, ${sender}, 'x', ${internal}, ${at})`;

describe("Ticket reports", () => {
  it("is for the Manager, and the Admin and CEO to view; Staff and unknown Roles are refused", async () => {
    expect(["Manager", "CREOMS Manager", "Admin", "CEO"].every(mayReadTicketReport)).toBe(true);
    for (const role of ["Staff", "Staff/Employee", "Nobody"]) {
      expect(mayReadTicketReport(role)).toBe(false);
      expect(await loadTicketReport(deps(), { role, period, now: NOW })).toEqual({ ok: false, reason: "forbidden" });
    }
  });

  it("measures the first reply without On hold time, and ignores Internal notes", async () => {
    // Opened 10h ago, held 4h, answered after 8h by the clock: 4h of working time.
    const a = await ticket({ created: ago(10), held: 4 * 3600 });
    await message(a, "customer", ago(10));
    await message(a, "staff", ago(2));
    // A note at 9h is not a reply; the real reply at 5h (opened 6h ago) is 1h.
    const b = await ticket({ created: ago(6) });
    await message(b, "staff", ago(9), true);
    await message(b, "staff", ago(5));
    const report = await run();
    expect(report.firstReplyMedian).toBe(9000);
  });

  it("measures the resolve time without waiting on the Customer", async () => {
    const t = await ticket({ created: ago(30), status: "resolved", resolved: ago(1), claimer: "ana" });
    await message(t, "customer", ago(30));
    await message(t, "staff", ago(28));
    await message(t, "customer", ago(20)); // waited on the Customer for 8h
    await message(t, "staff", ago(19));
    await message(t, "customer", ago(5)); // waited another 14h
    const report = await run();
    expect(report.resolveMedian).toBe(7 * 3600);
    expect(report.resolvedCount).toBe(1);
  });

  it("counts the share meeting the Service level, keeping a stamped miss", async () => {
    const ok = await ticket({ created: ago(30), status: "resolved", resolved: ago(20) });
    await message(ok, "staff", ago(29));
    const late = await ticket({ created: ago(100) });
    await message(late, "staff", ago(10));
    const stamped = await ticket({ created: ago(30) });
    await message(stamped, "staff", ago(29));
    await db.sql`insert into crms.ticket_service_misses (ticket_id, kind) values (${stamped}, 'resolve')`;
    await ticket({ created: ago(1) }); // still running: not judged
    const report = await run();
    expect(report.judged).toBe(3);
    expect(report.metShare).toBeCloseTo(1 / 3);
  });

  it("counts a Resolved Ticket as reopened when it is Open again or has a Follow-up", async () => {
    const stay = await ticket({ created: ago(50), status: "completed", resolved: ago(40) });
    await ticket({ created: ago(50), status: "open", resolved: ago(40) });
    const followed = await ticket({ created: ago(50), status: "completed", resolved: ago(40) });
    await ticket({ created: ago(5), followUpOf: followed });
    expect(stay).toBeGreaterThan(0);
    const report = await run();
    expect(report.resolvedCount).toBe(3);
    expect(report.reopened).toBe(2);
    expect(report.reopenRate).toBeCloseTo(2 / 3);
  });

  it("reports ratings, the lowest with comments, and each Staff member's load", async () => {
    await ticket({ created: ago(30), status: "resolved", resolved: ago(5), claimer: "ana", rating: 5, ratedAt: ago(4) });
    await ticket({ created: ago(30), status: "completed", resolved: ago(5), claimer: "ana", rating: 1, comment: "Late again", ratedAt: ago(3) });
    await ticket({ created: ago(3), status: "open", claimer: "ben" });
    await ticket({ created: ago(3), status: "on_hold", claimer: "ben" });
    await ticket({ created: ago(3), rating: 2, ratedAt: ago(1000) }); // rated outside the period
    const report = await run();
    expect(report.averageRating).toBe(3);
    expect(report.lowest[0]).toMatchObject({ rating: 1, comment: "Late again" });
    expect(report.staff).toEqual([
      expect.objectContaining({ id: "ben", open: 2, resolved: 0, averageRating: null }),
      expect.objectContaining({ id: "ana", open: 0, resolved: 2, averageRating: 3 }),
    ]);
  });

  it("counts Tickets by Category and Escalations in the period", async () => {
    await ticket({ category: "Delivery", created: ago(3) });
    await ticket({ category: "Delivery", created: ago(4) });
    await ticket({ category: "Refund", created: ago(4) });
    await ticket({ category: "Refund", created: ago(24 * 60) }); // before the period
    await db.sql`insert into crms.ticket_escalations (ticket_id, reason, note, escalated_by_id, escalated_by_name, operation_id, created_at) values (1, 'money', 'n', 'u', 'U', 'op1', ${ago(2)})`;
    await db.sql`insert into crms.ticket_escalations (ticket_id, reason, note, escalated_by_id, escalated_by_name, operation_id, created_at) values (2, 'money', 'n', 'u', 'U', 'op2', ${ago(24 * 60)})`;
    const report = await run();
    expect(report.categories).toEqual([{ category: "Delivery", count: 2 }, { category: "Refund", count: 1 }]);
    expect(report.escalated).toBe(1);
  });

  it("shows empty figures as none, not zero", async () => {
    const report = await run("CEO");
    expect(report).toMatchObject({ firstReplyMedian: null, resolveMedian: null, metShare: null, reopenRate: null, averageRating: null, escalated: 0, categories: [], staff: [], lowest: [] });
  });

  it("says unavailable when the database cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = (() => { throw new Error("down"); }) as unknown as typeof db.sql;
    expect(await loadTicketReport({ tickets: down, crms: db.sql }, { role: "Manager", period, now: NOW })).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("the report period", () => {
  it("defaults to the last 30 whole Philippine days", () => {
    const { start, end } = resolveReportPeriod(parseReportPreset(undefined), new Date("2026-10-20T12:00:00Z"));
    expect(end.toISOString()).toBe("2026-10-20T16:00:00.000Z");
    expect(start.toISOString()).toBe("2026-09-20T16:00:00.000Z");
    expect(parseReportPreset("bogus")).toBe("30-days");
    expect(parseReportPreset("7-days")).toBe("7-days");
  });
});
