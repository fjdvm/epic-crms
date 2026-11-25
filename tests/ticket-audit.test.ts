import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { claim, release, resolve, reply } from "@/features/tickets/actions";

const audit = vi.hoisted(() => vi.fn<import("@/lib/audit-trail").AuditTrail>(async () => {}));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit, gatewayFileStorage: {}, storefrontTicketUrl: () => "https://store/ticket", sendAppEmail: async () => {} }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: async () => ({ id: "portal-17", username: "ana", name: "Ana", role: "Staff" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => db.sql, ticketsWriterDatabase: () => db.sql }));
import { startTestDatabase, type TestDatabase } from "./ticket-database";
let db: TestDatabase;
beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  audit.mockReset();
  await db.sql`truncate ticket_messages, tickets, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria', 'maria@example.com')`;
  await db.sql`insert into tickets (customer_id, subject) values ('c1', 'Leaking pouch')`;
});
it("records claim, release and status changes once and leaves Messages to the Conversation", async () => {
  expect(await claim(1)).toEqual({ ok: true });
  await claim(1);
  const form = new FormData(); form.set("body", "I can help");
  expect(await reply(1, form)).toMatchObject({ ok: true });
  expect(await release(1)).toEqual({ ok: true });
  await release(1);
  expect(await resolve(1)).toMatchObject({ ok: true });
  await resolve(1);
  // Each refused repeat is one failure event; the reply event holds the message id, never its text.
  expect(audit.mock.calls.map(([e]) => [e.action, e.outcome])).toEqual([
    ["ticket.claimed", "success"], ["ticket.claimed", "failure"], ["ticket.replied", "success"], ["ticket.released", "success"],
    ["ticket.released", "failure"], ["ticket.status_changed", "success"], ["ticket.status_changed", "failure"],
  ]);
  expect(JSON.stringify(audit.mock.calls)).not.toContain("I can help");
  expect(audit.mock.calls[1][0]).toMatchObject({ metadata: { reason: "claimed" }, description: expect.stringMatching(/Ana could not claim TKT-1: claimed/) });
  expect(audit.mock.calls[2][0].metadata).toEqual({ messageId: 1, withImage: false });
  for (const [event] of audit.mock.calls.filter(([e]) => e.outcome === "success")) expect(event).toMatchObject({ module: "Tickets", outcome: "success", actor: { type: "user", id: "portal-17", display_name: "Ana" }, target: { type: "ticket", id: "1", display_name: "TKT-1" }, description: expect.stringMatching(/Ana.*TKT-1/), operationId: expect.any(String) });
});
it("keeps confirmed changes when auditing throws and distinguishes later claims", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  audit.mockRejectedValueOnce(new Error("offline"));
  expect(await claim(1)).toEqual({ ok: true });
  await release(1); await claim(1);
  expect(audit.mock.calls[0][0].operationId).not.toBe(audit.mock.calls[2][0].operationId);
  expect(log).toHaveBeenCalled(); log.mockRestore();
});
it("audits Priority changes, skips unchanged retries and refuses invalid or completed changes", async () => {
  const { changePriority } = await import("@/features/tickets/actions");
  expect(await changePriority(1, "urgent")).toEqual({ ok: true });
  await changePriority(1, "urgent");
  expect(audit.mock.calls.map(([e]) => e.outcome)).toEqual(["success", "failure"]);
  expect(audit.mock.calls[0][0]).toMatchObject({ action: "ticket.priority_changed", description: "Ana changed Priority to urgent on Ticket TKT-1." });
  expect(await changePriority(1, "bad")).toMatchObject({ ok: false });
  await db.sql`update tickets set status = 'completed' where id = 1`;
  expect(await changePriority(1, "low")).toMatchObject({ ok: false });
  expect(audit.mock.calls.map(([e]) => e.outcome)).toEqual(["success", "failure", "failure", "failure"]);
  expect(audit.mock.calls.slice(2).map(([e]) => e.metadata?.reason)).toEqual(["invalid-priority", "completed"]);
});
it("retains submission identity when an old mutation is replayed after another change", async () => {
  const { changePriority } = await import("@/features/tickets/actions");
  await claim(1, "first-claim"); await release(1, "release"); await claim(1, "first-claim");
  expect(audit.mock.calls[0][0].operationId).toBe(audit.mock.calls[2][0].operationId);
  audit.mockClear();
  await changePriority(1, "urgent", "priority-urgent");
  await changePriority(1, "low", "priority-low");
  await changePriority(1, "urgent", "priority-urgent");
  expect(audit.mock.calls[0][0].operationId).toBe(audit.mock.calls[2][0].operationId);
  expect(new Set(audit.mock.calls.map(([e]) => e.operationId)).size).toBe(2);
});
it("puts a Ticket on hold with the Claimer's own Message, audits it, and refuses a missing date", async () => {
  const { putOnHold, takeOffHold } = await import("@/features/tickets/actions");
  await claim(1);
  audit.mockClear();
  const until = new Date(Date.now() + 3_600_000).toISOString();

  expect(await putOnHold(1, { reason: "courier", until: "", message: "hi" })).toEqual({ ok: false, reason: "invalid-hold-date" });
  expect(await putOnHold(1, { reason: "courier", until, message: " We're waiting on the rider. " })).toEqual({ ok: true, messageSent: true });
  expect((await db.sql`select body, sender from ticket_messages where ticket_id = 1`)).toEqual([{ body: "We're waiting on the rider.", sender: "staff" }]);
  expect(await takeOffHold(1)).toEqual({ ok: true });
  expect(audit.mock.calls.map(([e]) => [e.action, e.outcome])).toEqual([["ticket.put_on_hold", "failure"], ["ticket.put_on_hold", "success"], ["ticket.taken_off_hold", "success"]]);
  expect(audit.mock.calls[0][0].metadata).toEqual({ reason: "invalid-hold-date" });
});
it("audits an Internal note by id only, and a refused or read-only attempt as a failure", async () => {
  const { addNote } = await import("@/features/tickets/actions");
  expect(await addNote(1, "Customer sounds upset")).toMatchObject({ ok: true });
  expect(await addNote(1, "   ")).toEqual({ ok: false, reason: "note-empty" });
  await addNote(1, "   ");
  expect(audit.mock.calls.map(([e]) => [e.action, e.outcome])).toEqual([["ticket.note_added", "success"], ["ticket.note_added", "failure"], ["ticket.note_added", "failure"]]);
  expect(JSON.stringify(audit.mock.calls)).not.toContain("upset");
  expect(audit.mock.calls[1][0].operationId).toBe(audit.mock.calls[2][0].operationId);
});
it("audits a refused attempt once per replay and keeps a read-only Role's attempt", async () => {
  const staff = await import("@/lib/portal/staff");
  const { claim: claimAs } = await import("@/features/tickets/actions");
  expect(await claimAs(99, "t1")).toMatchObject({ ok: false, reason: "not-found" });
  await claimAs(99, "t1");
  expect(audit.mock.calls[0][0].operationId).toBe(audit.mock.calls[1][0].operationId);
  void staff;
});
