import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadAttention } from "@/features/dashboard/attention";
import { DEFAULT_TARGETS, describeClock, serviceLevel, targetsAt, type ClockInput } from "@/features/tickets/service-level";
import { loadTargetHistory, setServiceTargets } from "@/features/tickets/service-level-store";
import { getTicket } from "@/features/tickets/ticket";
import { listTickets } from "@/features/tickets/tickets";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

const NOW = new Date("2026-10-20T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3600_000);
const base = (over: Partial<ClockInput> = {}): ClockInput => ({
  status: "open", createdAt: ago(10), resolvedAt: null, heldSeconds: 0, holdStartedAt: null, messages: [], ...over,
});

describe("the Service level clock", () => {
  it("counts every hour from when the Ticket was opened", () => {
    const level = serviceLevel(base({ createdAt: ago(10) }), DEFAULT_TARGETS, NOW);
    expect(level.firstReply).toMatchObject({ state: "running", remainingSeconds: 14 * 3600 });
    expect(describeClock(level.firstReply)).toBe("14h 0m left");
  });

  it("warns under an hour and says Missed after the target", () => {
    expect(serviceLevel(base({ createdAt: ago(23.5) }), DEFAULT_TARGETS, NOW).firstReply.state).toBe("breaching");
    expect(describeClock(serviceLevel(base({ createdAt: ago(23.5) }), DEFAULT_TARGETS, NOW).firstReply)).toBe("Breaching soon");
    expect(describeClock(serviceLevel(base({ createdAt: ago(25) }), DEFAULT_TARGETS, NOW).firstReply)).toBe("Missed");
  });

  it("stops while On hold and resumes after, without counting the hold", () => {
    const held = serviceLevel(base({ createdAt: ago(10), status: "on_hold", holdStartedAt: ago(4) }), DEFAULT_TARGETS, NOW);
    expect(held.firstReply).toMatchObject({ state: "paused", pausedFor: "hold", remainingSeconds: 18 * 3600 });
    const later = serviceLevel(base({ createdAt: ago(10), status: "on_hold", holdStartedAt: ago(1) }), DEFAULT_TARGETS, NOW);
    expect(later.firstReply.remainingSeconds).toBe(15 * 3600);
    const resumed = serviceLevel(base({ createdAt: ago(10), heldSeconds: 4 * 3600 }), DEFAULT_TARGETS, NOW);
    expect(resumed.firstReply).toMatchObject({ state: "running", remainingSeconds: 18 * 3600 });
  });

  it("judges the first reply by when Staff answered, then runs the resolve target", () => {
    const answered = serviceLevel(base({ createdAt: ago(30), messages: [{ sender: "customer", at: ago(30) }, { sender: "staff", at: ago(20) }] }), DEFAULT_TARGETS, NOW);
    expect(answered.firstReply.state).toBe("met");
    expect(answered.current.kind).toBe("resolve");
    const late = serviceLevel(base({ createdAt: ago(40), messages: [{ sender: "staff", at: ago(10) }] }), DEFAULT_TARGETS, NOW);
    expect(late.firstReply.state).toBe("missed");
  });

  it("stops the resolve clock while waiting on the Customer and restarts at their next Message", () => {
    const messages = [{ sender: "customer" as const, at: ago(10) }, { sender: "staff" as const, at: ago(9) }];
    const waiting = serviceLevel(base({ createdAt: ago(10), messages }), DEFAULT_TARGETS, NOW);
    expect(waiting.resolve).toMatchObject({ state: "paused", pausedFor: "customer", remainingSeconds: 71 * 3600 });
    const back = serviceLevel(base({ createdAt: ago(10), messages: [...messages, { sender: "customer", at: ago(5) }] }), DEFAULT_TARGETS, NOW);
    expect(back.resolve).toMatchObject({ state: "running", remainingSeconds: (72 - 6) * 3600 });
  });

  it("ends the resolve target when Staff mark it Resolved", () => {
    const level = serviceLevel(base({ createdAt: ago(100), status: "resolved", resolvedAt: ago(60) }), DEFAULT_TARGETS, NOW);
    expect(level.resolve.state).toBe("met");
    expect(serviceLevel(base({ createdAt: ago(100), status: "resolved", resolvedAt: ago(10) }), DEFAULT_TARGETS, NOW).resolve.state).toBe("missed");
  });

  it("never clears a stamped miss", () => {
    const level = serviceLevel(base({ createdAt: ago(1), stamped: { firstReply: true } }), DEFAULT_TARGETS, NOW);
    expect(level.firstReply.state).toBe("missed");
  });

  it("takes the pair in force when the Ticket was opened", () => {
    const history = [
      { effectiveFrom: new Date(0), firstReplyHours: 24, resolveHours: 72 },
      { effectiveFrom: ago(5), firstReplyHours: 2, resolveHours: 6 },
    ];
    expect(targetsAt(history, ago(10)).firstReplyHours).toBe(24);
    expect(targetsAt(history, ago(1)).firstReplyHours).toBe(2);
  });
});

let db: TestDatabase;
const audit = vi.fn(async () => {});
const admin = { id: "ada", name: "Ada", role: "Super Admin" };

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-service-levels.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, orders, customers restart identity cascade`;
  await db.sql`truncate crms.service_level_changes, crms.ticket_service_misses`;
  await db.sql`insert into crms.service_level_changes (first_reply_hours, resolve_hours, effective_from) values (24, 72, '1970-01-01')`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Jane Doe', 'jane@example.com')`;
  audit.mockClear();
});

async function ticket(openedHoursAgo: number, messages: ["customer" | "staff", number][] = []) {
  const [row] = await db.sql<{ id: number }[]>`insert into tickets (customer_id, subject, created_at) values ('c1', 'Help', ${ago(openedHoursAgo)}) returning id`;
  for (const [sender, hours] of messages) await db.sql`insert into ticket_messages (ticket_id, sender, body, created_at) values (${row.id}, ${sender}, 'hi', ${ago(hours)})`;
  return row.id;
}

describe("saving the Service levels", () => {
  it("lets only an Admin change them, and audits the change with what it replaced", async () => {
    for (const role of ["CRMS Manager", "CEO", "Staff/Employee"]) {
      const refused = await setServiceTargets(db.sql, audit, { id: "x", name: "X", role }, { firstReplyHours: 2, resolveHours: 6 });
      expect(refused.ok).toBe(false);
    }
    expect(audit).not.toHaveBeenCalled();
    expect(await setServiceTargets(db.sql, audit, admin, { firstReplyHours: 12, resolveHours: 48 })).toEqual({ ok: true, targets: { firstReplyHours: 12, resolveHours: 48 } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "service_levels.changed", metadata: expect.objectContaining({ previousFirstReplyHours: 24, firstReplyHours: 12 }) }));
    const [row] = await db.sql`select changed_by_name, previous_resolve_hours from crms.service_level_changes order by id desc limit 1`;
    expect(row).toMatchObject({ changed_by_name: "Ada", previous_resolve_hours: 72 });
  });

  it("refuses values that are not whole hours or that put resolve before the first reply", async () => {
    for (const input of [{ firstReplyHours: 0, resolveHours: 5 }, { firstReplyHours: 1.5, resolveHours: 5 }, { firstReplyHours: "2", resolveHours: 5 }, { firstReplyHours: 10, resolveHours: 5 }]) {
      expect((await setServiceTargets(db.sql, audit, admin, input)).ok).toBe(false);
    }
    expect(await loadTargetHistory(db.sql)).toHaveLength(1);
  });

  it("applies a change only to Tickets opened afterwards", async () => {
    const old = await ticket(20);
    await setServiceTargets(db.sql, audit, admin, { firstReplyHours: 12, resolveHours: 48 });
    const [{ id: fresh }] = await db.sql<{ id: number }[]>`insert into tickets (customer_id, subject) values ('c1', 'New') returning id`;
    const history = await loadTargetHistory(db.sql);
    expect((await getTicket(db.sql, old, NOW, { history }))!.serviceLevel.targets.firstReplyHours).toBe(24);
    expect((await getTicket(db.sql, fresh, new Date(), { history }))!.serviceLevel.targets.firstReplyHours).toBe(12);
  });
});

describe("the countdown from the database", () => {
  it("pauses across On hold, counting the hold however it ends", async () => {
    const id = await ticket(10);
    await db.sql`update tickets set status = 'on_hold' where id = ${id}`;
    await db.sql`update tickets set hold_started_at = ${ago(4)} where id = ${id}`;
    const history = await loadTargetHistory(db.sql);
    let t = (await getTicket(db.sql, id, NOW, { history }))!;
    expect(t.serviceLevel.firstReply).toMatchObject({ state: "paused", remainingSeconds: 18 * 3600 });
    await db.sql`update tickets set status = 'open' where id = ${id}`; // the Customer wrote, or the hold ran out
    const [row] = await db.sql`select held_seconds from tickets where id = ${id}`;
    expect(row.held_seconds).toBeGreaterThanOrEqual(0);
    await db.sql`update tickets set held_seconds = ${4 * 3600} where id = ${id}`;
    t = (await getTicket(db.sql, id, NOW, { history }))!;
    expect(t.serviceLevel.firstReply).toMatchObject({ state: "running", remainingSeconds: 18 * 3600 });
  });

  it("stamps a miss once and keeps it", async () => {
    const id = await ticket(30);
    const history = await loadTargetHistory(db.sql);
    expect((await getTicket(db.sql, id, NOW, { history, sql: db.sql }))!.serviceLevel.firstReply.state).toBe("missed");
    const [first] = await db.sql`select missed_at from crms.ticket_service_misses where ticket_id = ${id} and kind = 'first_reply'`;
    await db.sql`update tickets set created_at = ${ago(1)} where id = ${id}`; // the data now says it was on time
    expect((await getTicket(db.sql, id, NOW, { history, sql: db.sql }))!.serviceLevel.firstReply.state).toBe("missed");
    const [again] = await db.sql`select missed_at from crms.ticket_service_misses where ticket_id = ${id} and kind = 'first_reply'`;
    expect(again.missed_at).toEqual(first.missed_at);
  });

  it("Overdue follows the Admin's first reply target, and the list and the Dashboard agree", async () => {
    await setServiceTargets(db.sql, audit, admin, { firstReplyHours: 6, resolveHours: 48 });
    await db.sql`update crms.service_level_changes set effective_from = now() - interval '10 hours' where first_reply_hours = 6`;
    const history = await loadTargetHistory(db.sql);
    const opened = new Date(Date.now());
    await db.sql`insert into tickets (customer_id, subject, created_at) values ('c1', 'before the change', ${ago(30)})`;
    const [{ id }] = await db.sql<{ id: number }[]>`insert into tickets (customer_id, subject, created_at) values ('c1', 'after the change', ${new Date(opened.getTime() - 7 * 3600_000)}) returning id`;
    await db.sql`insert into ticket_messages (ticket_id, sender, body, created_at) values (${id}, 'customer', 'hi', ${new Date(opened.getTime() - 7 * 3600_000)})`;
    const now = opened;
    const list = await listTickets(db.sql, { now, levels: { history } });
    const dash = await loadAttention(() => db.sql, { modules: ["Tickets"], now, targets: history });
    // The first Ticket kept 24 h and is Overdue at 30 h; the second took 6 h and is Overdue at 7 h.
    expect(list.overdue).toBe(2);
    expect(dash.openTickets).toMatchObject({ ok: true, overdue: 2 });
    const unreadable = await loadAttention(() => db.sql, { modules: ["Tickets"], now, targets: null });
    expect(unreadable.openTickets).toEqual({ ok: false });
  });
});
