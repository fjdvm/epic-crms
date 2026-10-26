import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { claim, release, resolve, reply } from "@/features/tickets/actions";

const audit = vi.hoisted(() => vi.fn<import("@/lib/audit-trail").AuditTrail>(async () => {}));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit, gatewayFileStorage: {}, storefrontTicketUrl: () => "https://store/ticket", sendAppEmail: async () => {} }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: async () => ({ id: "portal-17", username: "ana", name: "Ana" }) }));
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
  expect(audit).toHaveBeenCalledTimes(1);
  expect(await release(1)).toEqual({ ok: true });
  await release(1);
  expect(await resolve(1)).toMatchObject({ ok: true });
  await resolve(1);
  expect(audit.mock.calls.map(([e]) => e.action)).toEqual(["ticket.claimed", "ticket.released", "ticket.status_changed"]);
  for (const [event] of audit.mock.calls) expect(event).toMatchObject({ module: "Tickets", outcome: "success", actor: { type: "user", id: "portal-17", display_name: "Ana" }, target: { type: "ticket", id: "1", display_name: "TKT-1" }, description: expect.stringMatching(/Ana.*TKT-1/), operationId: expect.any(String) });
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
  expect(audit).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls[0][0]).toMatchObject({ action: "ticket.priority_changed", description: "Ana changed Priority to urgent on Ticket TKT-1." });
  expect(await changePriority(1, "bad")).toMatchObject({ ok: false });
  await db.sql`update tickets set status = 'completed' where id = 1`;
  expect(await changePriority(1, "low")).toMatchObject({ ok: false });
  expect(audit).toHaveBeenCalledTimes(1);
});
