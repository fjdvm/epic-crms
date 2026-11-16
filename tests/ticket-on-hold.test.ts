import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getTicket } from "@/features/tickets/ticket";
import { listTickets } from "@/features/tickets/tickets";
import {
  claimTicket,
  putTicketOnHold,
  releaseTicket,
  replyToTicket,
  takeTicketOffHold,
  type Actor,
} from "@/features/tickets/ticket-actions";
import { loadDashboardFigures } from "@/features/dashboard/figures";
import { resolvePeriod } from "@/features/dashboard/period";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

const bernice: Actor = { id: "bernice", name: "Bernice" };
const carlo: Actor = { id: "carlo", name: "Carlo" };
const NOW = new Date("2026-10-20T12:00:00Z");
const later = new Date("2026-10-21T12:00:00Z");

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, first_name, email) values ('c1', 'Maria Santos', 'Maria', 'maria@example.com')`;
});

async function claimed(options: { status?: string; by?: Actor | null } = {}) {
  const by = options.by === undefined ? bernice : options.by;
  const [row] = await db.sql<{ id: number }[]>`
    insert into tickets (customer_id, subject, status, claimed_by_id, claimed_by_name, created_at)
    values ('c1', 'Where is my cake?', ${options.status ?? "open"}, ${by?.id ?? null}, ${by?.name ?? null}, ${new Date("2026-10-01T00:00:00Z")})
    returning id`;
  return row.id;
}

const row = async (id: number) =>
  (await db.sql<Record<string, unknown>[]>`select status, hold_reason, hold_note, hold_until from tickets where id = ${id}`)[0];

const hold = { reason: "courier", note: "Lalamove is down", until: later };

describe("Put on hold", () => {
  it("lets the Claimer hold an Open Ticket with a reason, a Staff-only note and a return date", async () => {
    const id = await claimed();

    expect(await putTicketOnHold(db.sql, id, bernice, hold, undefined, NOW)).toEqual({ ok: true });

    expect(await row(id)).toEqual({ status: "on_hold", hold_reason: "courier", hold_note: "Lalamove is down", hold_until: later });
  });

  it("shows any Staff the reason and note on the Ticket", async () => {
    const id = await claimed();
    await putTicketOnHold(db.sql, id, bernice, hold, undefined, NOW);

    expect((await getTicket(db.sql, id))?.hold).toEqual({ reason: "courier", note: "Lalamove is down", until: later });
  });

  it("only the Claimer can put it on hold", async () => {
    const id = await claimed();

    expect(await putTicketOnHold(db.sql, id, carlo, hold, undefined, NOW)).toEqual({ ok: false, reason: "not-claimer" });
    const unclaimed = await claimed({ by: null });
    expect(await putTicketOnHold(db.sql, unclaimed, carlo, hold, undefined, NOW)).toEqual({ ok: false, reason: "not-claimed" });
    expect((await row(id)).status).toBe("open");
  });

  it("requires a date and time in the future", async () => {
    const id = await claimed();

    expect(await putTicketOnHold(db.sql, id, bernice, { ...hold, until: null }, undefined, NOW)).toEqual({ ok: false, reason: "invalid-hold-date" });
    expect(await putTicketOnHold(db.sql, id, bernice, { ...hold, until: new Date("2026-10-20T11:00:00Z") }, undefined, NOW)).toEqual({ ok: false, reason: "invalid-hold-date" });
    expect(await putTicketOnHold(db.sql, id, bernice, { ...hold, until: new Date("nope") }, undefined, NOW)).toEqual({ ok: false, reason: "invalid-hold-date" });
    expect((await row(id)).status).toBe("open");
  });

  it("requires one of the four reasons and keeps the note short", async () => {
    const id = await claimed();

    expect(await putTicketOnHold(db.sql, id, bernice, { ...hold, reason: "boredom" }, undefined, NOW)).toEqual({ ok: false, reason: "invalid-hold-reason" });
    expect(await putTicketOnHold(db.sql, id, bernice, { ...hold, note: "x".repeat(501) }, undefined, NOW)).toEqual({ ok: false, reason: "note-too-long" });
  });

  it("holds only Open Tickets", async () => {
    for (const status of ["on_hold", "resolved"]) {
      const id = await claimed({ status });
      expect(await putTicketOnHold(db.sql, id, bernice, hold, undefined, NOW)).toEqual({ ok: false, reason: "not-open" });
    }
    const done = await claimed({ status: "completed" });
    expect(await putTicketOnHold(db.sql, done, bernice, hold, undefined, NOW)).toEqual({ ok: false, reason: "completed" });
  });

  it("records an audit event for the hold and for taking it off", async () => {
    const id = await claimed();
    const trail = vi.fn(async () => {});
    const audit = { trail, operationId: "op", staff: { id: "bernice", name: "Bernice", username: "bernice" } } as never;

    await putTicketOnHold(db.sql, id, bernice, hold, audit, NOW);
    await takeTicketOffHold(db.sql, id, bernice, audit);

    expect(trail.mock.calls.map((c) => (c as unknown as [{ action: string }])[0].action)).toEqual(["ticket.put_on_hold", "ticket.taken_off_hold"]);
  });
});

describe("Take off hold", () => {
  it("returns the Claimer's Ticket to Open and clears the hold", async () => {
    const id = await claimed();
    await putTicketOnHold(db.sql, id, bernice, hold, undefined, NOW);

    expect(await takeTicketOffHold(db.sql, id, bernice)).toEqual({ ok: true });

    expect(await row(id)).toEqual({ status: "open", hold_reason: null, hold_note: null, hold_until: null });
    expect((await getTicket(db.sql, id))?.hold).toBeNull();
  });

  it("is refused for others and when the Ticket is not on hold", async () => {
    const id = await claimed();
    await putTicketOnHold(db.sql, id, bernice, hold, undefined, NOW);

    expect(await takeTicketOffHold(db.sql, id, carlo)).toEqual({ ok: false, reason: "not-claimer" });
    await takeTicketOffHold(db.sql, id, bernice);
    expect(await takeTicketOffHold(db.sql, id, bernice)).toEqual({ ok: false, reason: "not-on-hold" });
    expect(await takeTicketOffHold(db.sql, 999, bernice)).toEqual({ ok: false, reason: "not-found" });
  });

  it("releasing a held Ticket also ends the hold, so it is never stuck Unclaimed On hold", async () => {
    const id = await claimed();
    await putTicketOnHold(db.sql, id, bernice, hold, undefined, NOW);

    expect(await releaseTicket(db.sql, id, bernice)).toEqual({ ok: true });

    expect(await row(id)).toMatchObject({ status: "open", hold_reason: null, hold_until: null });
  });
});

describe("While On hold", () => {
  it("the Claimer can still send the Customer a Message and the Ticket stays On hold", async () => {
    const id = await claimed();
    await putTicketOnHold(db.sql, id, bernice, hold, undefined, NOW);

    expect(await replyToTicket(db.sql, id, bernice, "We're waiting on the rider.")).toMatchObject({ ok: true });

    expect((await row(id)).status).toBe("on_hold");
  });

  it("is never Overdue: not on the Dashboard's Needs attention, and not in the Tickets list tabs", async () => {
    const id = await claimed({ by: null });
    await db.sql`insert into ticket_messages (ticket_id, sender, body, created_at) values (${id}, 'customer', 'hi', ${new Date("2026-10-01T00:00:00Z")})`;
    await db.sql`update tickets set status = 'on_hold', hold_reason = 'courier', hold_until = ${later} where id = ${id}`;

    const list = await listTickets(db.sql, { now: NOW });
    expect(list.overdue).toBe(0);
    expect(list.counts).toEqual({ open: 0, waiting: 0, resolved: 0 });

    const figures = await loadDashboardFigures(() => db.sql, {
      period: resolvePeriod("today", NOW),
      modules: ["Tickets"],
      now: NOW,
    });
    expect(figures.attention?.openTickets).toEqual({ ok: true, count: 0, overdue: 0, oldest: null });
  });
});
