import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { startTestDatabase, type TestDatabase } from "./ticket-database";
import {
  chatForTicket,
  handoffs,
  loadResults,
  todaysCounts,
  mayReadResults,
  weekStart,
} from "@/features/order-assistant/data";
import { flagAnswer } from "@/features/order-assistant/flag";
let db: TestDatabase;
const now = new Date("2026-11-17T04:00:00Z");
const staff = { role: "Staff", username: "s1", name: "Liza" };
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-assistant-flags.sql", "utf8"));
  await db.sql
    .unsafe(`create table assistant_chats(id integer primary key, ticket_id integer);
    create table assistant_messages(id integer primary key, chat_id integer, sender text, body text, outcome text, sent_to_model text, created_at timestamptz);
    create table assistant_handoffs(ticket_id integer, chat_id integer, reason text, summary text, sent_summary text, sent_source text, sent_to_model text, sent_at timestamptz, order_id integer, status text);`);
}, 60000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.sql`truncate assistant_chats, assistant_messages, assistant_handoffs, crms.assistant_answer_flags, tickets, customers restart identity cascade`;
  await db.sql`insert into customers(id,full_name,email) values ('c1','Customer','c@example.com')`;
  await db.sql`insert into tickets(customer_id,subject) values ('c1','Help')`;
  await db.sql`insert into assistant_chats values (1,1),(2,null)`;
  await db.sql`insert into assistant_messages values
    (1,1,'customer','where is my order?',null,null,'2026-11-16T01:00Z'),
    (2,1,'assistant','It is preparing','answered','exact masked model input','2026-11-16T01:01Z'),
    (3,2,'customer','payment status',null,null,'2026-11-16T02:00Z'),
    (4,2,'assistant','Paid','answered',null,'2026-11-16T02:01Z'),
    (5,2,'customer','pickup hours',null,null,'2026-11-15T15:59Z'),
    (6,2,'assistant','Monday','answered',null,'2026-11-15T15:59Z')`;
  await db.sql`insert into assistant_handoffs values (1,1,'person_requested','old draft','approved text','customer',null,'2026-11-16T03:00Z',null,'sent')`;
});
it("uses Manila Monday boundaries, actual stored questions and confirmed handoffs only", async () => {
  expect(weekStart(now).toISOString()).toBe("2026-11-15T16:00:00.000Z");
  const r = await loadResults(db.sql, db.sql, now);
  expect(r).toMatchObject({
    questions: 2,
    lastWeek: 1,
    answered: 1,
    handedOff: 1,
    flags: [],
  });
  expect(r.kinds).toEqual([
    ["order_status", 1],
    ["payment", 1],
  ]);
  expect(r.answeredByKind).toEqual({ order_status: 1, payment: 1 });
});
it("lists why the Ticket was handed off and reads exact chat/model input and approved summary", async () => {
  expect(await handoffs(db.sql)).toMatchObject([
    {
      ticket_id: 1,
      reason: "person_requested",
      summary: "approved text",
      sent_source: "customer",
    },
  ]);
  expect(await chatForTicket(db.sql, 1)).toMatchObject([
    { id: 1 },
    { id: 2, sent_to_model: "exact masked model input" },
  ]);
  expect(await chatForTicket(db.sql, 99)).toEqual([]);
});
it("records the reason and Staff identity, emits an Audit Event and never overwrites the first flag", async () => {
  const audit = vi.fn();
  const deps = { tickets: db.sql, crms: db.sql, audit };
  expect(await flagAnswer(deps, staff, 1, 2, "Wrong status")).toEqual({
    ok: true,
  });
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({
      actor: expect.objectContaining({ display_name: "Liza" }),
      metadata: { messageId: 2, reason: "Wrong status" },
    }),
  );
  const [saved] = await db.sql`select * from crms.assistant_answer_flags`;
  expect(saved).toMatchObject({
    staff_id: "s1",
    staff_name: "Liza",
    reason: "Wrong status",
    answer: "It is preparing",
  });
  expect((await flagAnswer(deps, staff, 1, 2, "overwrite")).ok).toBe(false);
  expect((await loadResults(db.sql, db.sql, new Date())).flags.length).toBe(1);
});
it("rejects read-only roles, invalid reasons, customer messages and answers from another Ticket", async () => {
  const deps = { tickets: db.sql, crms: db.sql, audit: vi.fn() };
  for (const role of ["Admin", "CEO", "Unknown"])
    expect((await flagAnswer(deps, { ...staff, role }, 1, 2, "wrong")).ok).toBe(
      false,
    );
  for (const reason of ["", "  ", "x".repeat(501)])
    expect((await flagAnswer(deps, staff, 1, 2, reason)).ok).toBe(false);
  expect((await flagAnswer(deps, staff, 1, 1, "wrong")).ok).toBe(false);
  expect((await flagAnswer(deps, staff, 9, 2, "wrong")).ok).toBe(false);
  expect(deps.audit).not.toHaveBeenCalled();
});
it("limits Results to Managers, Admin and CEO", () => {
  for (const role of ["CREOMS Manager", "Admin", "CEO"])
    expect(mayReadResults(role)).toBe(true);
  for (const role of ["Staff", "unknown"])
    expect(mayReadResults(role)).toBe(false);
});
it("counts today's questions and answers without a Ticket for the tab cards", async () => {
  expect(await todaysCounts(db.sql, new Date("2026-11-16T10:00:00Z"))).toEqual({
    questions: 2,
    answered: 1,
  });
});
