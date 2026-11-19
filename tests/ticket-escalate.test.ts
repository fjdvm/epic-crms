import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { describeNotification } from "@/features/notifications/describe";
import { listNotifications, type Viewer } from "@/features/notifications/notifications";
import { escalateTicket, listEscalations, openEscalatedIds, sendBackEscalation, takeEscalation, type Actor } from "@/features/tickets/escalate";
import { listReassignments } from "@/features/tickets/reassign";
import { getTicket } from "@/features/tickets/ticket";
import { listTickets } from "@/features/tickets/tickets";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const audit = vi.fn(async () => {});

const liza: Actor = { id: "u-liza", name: "Liza", username: "liza", role: "Staff" };
const mara: Actor = { id: "u-mara", name: "Mara", username: "mara", role: "CREOMS Manager" };
const managers = [{ username: "mara", name: "Mara" }, { username: "noel", name: "Noel" }];
const viewer = (id: string): Viewer => ({ customerProfiles: false, ticketsStaffId: id, feedback: false, orders: false, payments: false, returns: false });
const input = { reason: "money" as const, note: "Customer wants a refund over the limit" };

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  const base = readFileSync("docs/db/crms-schema.sql", "utf8").replace(/^--.*$/gm, "").split(";").map((s) => s.trim())
    .filter((s) => /^create table crms\.notifications|^create unique index notifications_new|^create index notifications_unread/i.test(s));
  for (const s of base) await db.sql.unsafe(s);
  await db.sql.unsafe(readFileSync("docs/db/crms-ticket-reassign.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-ticket-escalate.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, orders, customers restart identity cascade`;
  await db.sql`truncate crms.ticket_escalations, crms.ticket_reassignments, crms.notifications`;
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
const escalate = (id: number, actor = liza, over: Partial<typeof input> = {}, op = crypto.randomUUID()) =>
  escalateTicket(deps(), actor, id, { ...input, ...over }, managers, op);
const alerts = async (who: string) => (await listNotifications(db.sql, "crms", 20, viewer(who))).notifications;

describe("Escalate", () => {
  it("lets the Claimer escalate with a reason and note, and keeps them on the Ticket", async () => {
    const id = await ticket();

    expect(await escalate(id)).toEqual({ ok: true, alerted: 2 });

    expect((await getTicket(db.sql, id))?.claimerId).toBe("liza");
    expect(await openEscalatedIds(db.sql)).toEqual([id]);
    expect(await listEscalations(db.sql, id)).toMatchObject([{ reason: "money", note: input.note, escalatedByName: "Liza", resolution: null }]);
  });

  it("alerts every Manager and nobody else, and the alert says why", async () => {
    const id = await ticket();
    await escalate(id);

    const [forMara, forNoel] = [await alerts("mara"), await alerts("noel")];
    expect(forMara).toHaveLength(1);
    expect(forNoel).toHaveLength(1);
    expect(describeNotification(forMara[0])).toEqual({
      text: `Liza escalated TKT-${id}: Money decision. ${input.note}`,
      href: `/tickets/${id}`,
    });
    expect(await alerts("liza")).toHaveLength(0);
    expect(await alerts("carlo")).toHaveLength(0);
  });

  it("does not alert a Manager about their own escalation", async () => {
    const id = await ticket("mara", "Mara");
    expect(await escalate(id, mara)).toEqual({ ok: true, alerted: 1 });
    expect(await alerts("mara")).toHaveLength(0);
    expect(await alerts("noel")).toHaveLength(1);
  });

  it("is only for the Claimer", async () => {
    const mine = await ticket("carlo", "Carlo");
    const free = await ticket(null);

    expect(await escalate(mine)).toEqual({ ok: false, reason: "not-claimer" });
    expect(await escalate(free)).toEqual({ ok: false, reason: "not-claimer" });
    expect(await openEscalatedIds(db.sql)).toEqual([]);
    expect(await alerts("mara")).toHaveLength(0);
  });

  it("refuses a missing reason, an empty note, a long note, a Completed or missing Ticket", async () => {
    const id = await ticket();
    const done = await ticket("liza", "Liza", "completed");

    expect(await escalate(id, liza, { reason: "other" as never })).toEqual({ ok: false, reason: "invalid-reason" });
    expect(await escalate(id, liza, { note: "   " })).toEqual({ ok: false, reason: "note-required" });
    expect(await escalate(id, liza, { note: "x".repeat(501) })).toEqual({ ok: false, reason: "note-too-long" });
    expect(await escalate(done)).toEqual({ ok: false, reason: "completed" });
    expect(await escalate(9999)).toEqual({ ok: false, reason: "not-found" });
    expect(await openEscalatedIds(db.sql)).toEqual([]);
  });

  it("refuses a second escalation while one is open, and replays a retry without a second alert", async () => {
    const id = await ticket();
    const op = crypto.randomUUID();

    await escalate(id, liza, {}, op);
    expect(await escalate(id, liza, {}, op)).toEqual({ ok: true, alerted: 2 });
    expect(await escalate(id)).toEqual({ ok: false, reason: "already-escalated" });
    expect(await listEscalations(db.sql, id)).toHaveLength(1);
    expect(await alerts("mara")).toHaveLength(1);
    expect(audit).toHaveBeenCalledOnce();
  });

  it("audits with the reason, the note and the Staff member's name", async () => {
    const id = await ticket();
    await escalate(id);

    expect(audit.mock.calls[0] as unknown[]).toMatchObject([{ action: "ticket.escalated", target: { id: String(id) }, actor: { id: "u-liza", display_name: "Liza" } }]);
    expect(JSON.stringify(audit.mock.calls[0])).toContain(input.note);
  });

  it("never escalates by itself: an Overdue Ticket stays unescalated", async () => {
    const id = await ticket();
    await db.sql`update tickets set created_at = now() - interval '10 days' where id = ${id}`;

    const list = await listTickets(db.sql, { tab: "open", escalatedIds: await openEscalatedIds(db.sql) });
    expect(list.rows.find((r) => r.id === id)).toMatchObject({ overdue: true, escalated: false });
  });
});

describe("Take an escalated Ticket", () => {
  it("makes the Manager the Claimer, tells the previous Claimer, logs it and clears the badge", async () => {
    const id = await ticket();
    await escalate(id);

    expect(await takeEscalation(deps(), mara, id, crypto.randomUUID())).toEqual({ ok: true });

    const t = await getTicket(db.sql, id);
    expect([t?.claimerId, t?.claimerName]).toEqual(["mara", "Mara"]);
    expect(await openEscalatedIds(db.sql)).toEqual([]);
    expect(await listEscalations(db.sql, id)).toMatchObject([{ resolution: "taken", resolvedByName: "Mara" }]);
    expect(await listReassignments(db.sql, id)).toMatchObject([{ fromName: "Liza", toName: "Mara" }]);
    expect((await alerts("liza")).map((n) => n.kind)).toEqual(["ticket-reassigned"]);
    expect(audit.mock.calls.map((c) => (c as unknown as [{ action: string }])[0].action).sort()).toEqual([
      "ticket.escalated", "ticket.escalation-taken", "ticket.reassigned",
    ]);
  });

  it("is Manager only, and needs an open escalation", async () => {
    const id = await ticket();
    expect(await takeEscalation(deps(), mara, id, "op")).toEqual({ ok: false, reason: "not-escalated" });

    await escalate(id);
    for (const role of ["Staff", "Super Admin", "CEO"])
      expect(await takeEscalation(deps(), { ...mara, role }, id, "op")).toEqual({ ok: false, reason: "forbidden" });
    expect((await getTicket(db.sql, id))?.claimerId).toBe("liza");
    expect(await openEscalatedIds(db.sql)).toEqual([id]);
  });

  it("says so when the Ticket changed hands after the Manager looked, and leaves the escalation open", async () => {
    const id = await ticket();
    await escalate(id);
    await db.sql`update tickets set claimed_by_id = null, claimed_by_name = null where id = ${id}`;

    expect(await takeEscalation(deps(), mara, id, "op")).toEqual({ ok: false, reason: "not-claimed" });
    expect(await openEscalatedIds(db.sql)).toEqual([id]);
  });

  it("closes the escalation without a move when the Manager already holds the Ticket", async () => {
    const id = await ticket("mara", "Mara");
    await escalate(id, mara);

    expect(await takeEscalation(deps(), mara, id, "op")).toEqual({ ok: true });
    expect(await listReassignments(db.sql, id)).toEqual([]);
    expect(await openEscalatedIds(db.sql)).toEqual([]);
  });
});

describe("Send back", () => {
  it("clears the badge, keeps the Claimer, logs the note and tells the Claimer", async () => {
    const id = await ticket();
    await escalate(id);

    expect(await sendBackEscalation(deps(), mara, id, "Offer a voucher, no refund", crypto.randomUUID())).toEqual({ ok: true });

    expect((await getTicket(db.sql, id))?.claimerId).toBe("liza");
    expect(await openEscalatedIds(db.sql)).toEqual([]);
    expect(await listEscalations(db.sql, id)).toMatchObject([{ resolution: "sent_back", resolutionNote: "Offer a voucher, no refund", resolvedByName: "Mara" }]);
    const [alert] = await alerts("liza");
    expect(describeNotification(alert).text).toBe(`Mara sent TKT-${id} back to you. Offer a voucher, no refund`);
    expect(audit.mock.calls.map((c) => (c as unknown as [{ action: string }])[0].action)).toContain("ticket.escalation-sent-back");
  });

  it("needs a note, a Manager and an open escalation", async () => {
    const id = await ticket();
    expect(await sendBackEscalation(deps(), mara, id, "ok", "op")).toEqual({ ok: false, reason: "not-escalated" });

    await escalate(id);
    expect(await sendBackEscalation(deps(), mara, id, "  ", "op")).toEqual({ ok: false, reason: "note-required" });
    expect(await sendBackEscalation(deps(), { ...mara, role: "Staff" }, id, "ok", "op")).toEqual({ ok: false, reason: "forbidden" });
    expect(await openEscalatedIds(db.sql)).toEqual([id]);
  });

  it("lets the Claimer escalate again afterwards", async () => {
    const id = await ticket();
    await escalate(id);
    await sendBackEscalation(deps(), mara, id, "Try the voucher first", "op");

    expect(await escalate(id)).toEqual({ ok: true, alerted: 2 });
    expect(await listEscalations(db.sql, id)).toHaveLength(2);
  });
});

describe("The Escalated list filter", () => {
  it("lists only escalated Tickets and badges them", async () => {
    const a = await ticket();
    await ticket();
    await escalate(a);
    const escalatedIds = await openEscalatedIds(db.sql);

    const all = await listTickets(db.sql, { tab: "open", escalatedIds });
    const only = await listTickets(db.sql, { tab: "open", escalated: true, escalatedIds });

    expect(all.rows.filter((r) => r.escalated).map((r) => r.id)).toEqual([a]);
    expect(only.rows.map((r) => r.id)).toEqual([a]);
    expect(only.counts.open).toBe(1);
  });
});
