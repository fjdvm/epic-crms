import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { describeNotification } from "@/features/notifications/describe";
import { listNotifications, type Viewer } from "@/features/notifications/notifications";
import { listReassignments, reassignTickets, ticketsHeldBy, claimerWorkload, type Mover, type Teammate } from "@/features/tickets/reassign";
import { getTicket } from "@/features/tickets/ticket";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const audit = vi.fn(async () => {});

const manager: Mover = { id: "u-mgr", name: "Mara", username: "mara", role: "CREOMS Manager" };
const staffer: Mover = { id: "u-st", name: "Bernice", username: "bernice", role: "Staff" };
const rhea: Teammate = { id: "rhea", name: "Rhea", role: "staff" };
const viewer = (id: string): Viewer => ({ customerProfiles: false, ticketsStaffId: id, feedback: false, orders: false, payments: false, returns: false });

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  const base = readFileSync("docs/db/crms-schema.sql", "utf8").replace(/^--.*$/gm, "").split(";").map((s) => s.trim())
    .filter((s) => /^create table crms\.notifications|^create unique index notifications_new|^create index notifications_unread/i.test(s));
  for (const s of base) await db.sql.unsafe(s);
  await db.sql.unsafe(readFileSync("docs/db/crms-ticket-reassign.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, orders, customers restart identity cascade`;
  await db.sql`truncate crms.ticket_reassignments, crms.notifications`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'm@example.com')`;
  audit.mockClear();
});

async function ticket(claimer: string | null = "liza", name = "Liza", status = "open") {
  const [row] = await db.sql<{ id: number }[]>`
    insert into tickets (customer_id, subject, status, claimed_by_id, claimed_by_name)
    values ('c1', 'Cake', ${status}, ${claimer}, ${claimer ? name : null}) returning id`;
  return row.id;
}
const deps = () => ({ tickets: db.sql, crms: db.sql, audit });
const req = (ids: number[], over: Partial<Parameters<typeof reassignTickets>[2]> = {}) =>
  ({ ticketIds: ids, fromId: "liza", to: rhea, reason: "Liza is off today", operationId: crypto.randomUUID(), bulk: false, customer: { id: "c1", name: "Maria Santos" }, ...over });

describe("Manager reassign", () => {
  it("moves a Ticket to the named Staff member and logs it on the Ticket", async () => {
    const id = await ticket();

    expect(await reassignTickets(deps(), manager, req([id]))).toEqual({ ok: true, moved: [id], skipped: [] });

    const t = await getTicket(db.sql, id);
    expect([t?.claimerId, t?.claimerName]).toEqual(["rhea", "Rhea"]);
    expect(await listReassignments(db.sql, id)).toMatchObject([{ fromName: "Liza", toName: "Rhea", reason: "Liza is off today", movedByName: "Mara" }]);
  });

  it("writes an audit event with the reason", async () => {
    const id = await ticket();
    await reassignTickets(deps(), manager, req([id]));

    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0] as unknown[]).toMatchObject([{ action: "ticket.reassigned", target: { id: String(id) }, actor: { id: "u-mgr" } }]);
    expect(JSON.stringify(audit.mock.calls[0])).toContain("Liza is off today");
  });

  it("requires a reason", async () => {
    const id = await ticket();

    expect(await reassignTickets(deps(), manager, req([id], { reason: "   " }))).toEqual({ ok: false, reason: "reason-required" });
    expect((await getTicket(db.sql, id))?.claimerId).toBe("liza");
  });

  it("alerts the previous and the new Claimer with the reason", async () => {
    const id = await ticket();
    await reassignTickets(deps(), manager, req([id]));

    const previous = (await listNotifications(db.sql, "crms", 20, viewer("liza"))).notifications;
    const next = (await listNotifications(db.sql, "crms", 20, viewer("rhea"))).notifications;
    const other = (await listNotifications(db.sql, "crms", 20, viewer("carlo"))).notifications;

    expect(previous).toHaveLength(1);
    expect(describeNotification(previous[0]).text).toBe(`Mara moved TKT-${id} from you to Rhea. Reason: Liza is off today`);
    expect(describeNotification(next[0]).text).toBe(`Mara moved TKT-${id} from Liza to you. Reason: Liza is off today`);
    expect(other).toHaveLength(0);
  });

  it("refuses Staff, Admin and CEO", async () => {
    const id = await ticket();

    for (const role of ["Staff", "Super Admin"])
      expect(await reassignTickets(deps(), { ...staffer, role }, req([id]))).toEqual({ ok: false, reason: "forbidden" });
    expect((await getTicket(db.sql, id))?.claimerId).toBe("liza");
  });

  it("says plainly when someone else moved the Ticket first and leaves it alone", async () => {
    const id = await ticket("carlo", "Carlo");

    expect(await reassignTickets(deps(), manager, req([id]))).toEqual({ ok: false, reason: "claimer-changed" });
    expect((await getTicket(db.sql, id))?.claimerId).toBe("carlo");
    expect(await listReassignments(db.sql, id)).toEqual([]);
  });

  it("refuses a Completed or Unclaimed Ticket and a move to the same person", async () => {
    const done = await ticket("liza", "Liza", "completed");
    const free = await ticket(null);
    const mine = await ticket();

    expect(await reassignTickets(deps(), manager, req([done]))).toEqual({ ok: false, reason: "completed" });
    expect(await reassignTickets(deps(), manager, req([free]))).toEqual({ ok: false, reason: "not-claimed" });
    expect(await reassignTickets(deps(), manager, req([mine], { to: { id: "liza", name: "Liza", role: "staff" } }))).toEqual({ ok: false, reason: "unchanged" });
  });

  it("replays a retried operation without moving or alerting twice", async () => {
    const id = await ticket();
    const r = req([id]);

    await reassignTickets(deps(), manager, r);
    expect(await reassignTickets(deps(), manager, r)).toEqual({ ok: true, moved: [id], skipped: [] });
    expect(await listReassignments(db.sql, id)).toHaveLength(1);
    expect((await listNotifications(db.sql, "crms", 20, viewer("rhea"))).notifications).toHaveLength(1);
  });
});

describe("Move all of an absent teammate's Tickets", () => {
  it("shows the Tickets and workload before, then moves them all to one person with one alert each", async () => {
    const a = await ticket();
    const b = await ticket("liza", "Liza", "on_hold");
    await ticket("carlo", "Carlo");
    await ticket("liza", "Liza", "completed");
    await ticket("rhea", "Rhea");

    expect((await ticketsHeldBy(db.sql, "liza")).map((t) => t.id)).toEqual([a, b]);
    expect(Object.fromEntries(await claimerWorkload(db.sql))).toEqual({ liza: 2, carlo: 1, rhea: 1 });

    const result = await reassignTickets(deps(), manager, req([a, b], { bulk: true }));

    expect(result).toEqual({ ok: true, moved: [a, b], skipped: [] });
    expect(Object.fromEntries(await claimerWorkload(db.sql))).toEqual({ carlo: 1, rhea: 3 });
    const alerts = (await listNotifications(db.sql, "crms", 20, viewer("rhea"))).notifications;
    expect(alerts).toHaveLength(1);
    expect(describeNotification(alerts[0]).text).toBe("Mara moved 2 Tickets from Liza to you. Reason: Liza is off today");
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it("skips a Ticket that changed hands after the Manager looked", async () => {
    const a = await ticket();
    const b = await ticket("carlo", "Carlo");

    expect(await reassignTickets(deps(), manager, req([a, b], { bulk: true }))).toEqual({ ok: true, moved: [a], skipped: [b] });
  });
});
