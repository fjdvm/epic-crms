import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyField, latestSuggestion, parseSuggestion, suggestForTicket, ticketText } from "@/features/tickets/suggest";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const audit = vi.fn(async () => {});
const liza = { id: "liza", name: "Liza" };
const staff = { id: "portal-liza", name: "Liza" };

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-ticket-ai-suggestions.sql", "utf8"));
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, customers restart identity cascade`;
  await db.sql`truncate crms.ticket_ai_suggestions`;
  await db.sql`insert into customers (id, full_name, first_name, email) values ('c1', 'Maria Santos', 'Maria', 'maria@example.com')`;
  audit.mockClear();
});

async function ticket(status = "open") {
  const [row] = await db.sql<{ id: number }[]>`insert into tickets (customer_id, subject, status) values ('c1', 'Leaking pouch', ${status}) returning id`;
  await db.sql`insert into ticket_messages (ticket_id, sender, body) values (${row.id}, 'customer', 'Hi, email me at maria@example.com or call 0917 123 4567. It leaks!')`;
  await db.sql`insert into ticket_messages (ticket_id, sender, body, internal, author_name) values (${row.id}, 'staff', 'SECRET diagnosis', true, 'Liza')`;

  return row.id;
}

const deps = () => ({ tickets: db.sql, crms: db.sql, audit, staff });
const reply = JSON.stringify({ category: "delivery issue", categoryReason: "Leak in transit", priority: "high", priorityReason: "Food safety" });
const model = (complete: (s: string, u: string) => Promise<unknown>) => [{ model: "m1", complete }];

describe("AI-suggested Category and Priority", () => {
  it("sends only the Ticket text and records exactly what was sent", async () => {
    const id = await ticket();
    const complete = vi.fn(async (_system: string, _user: string) => reply);

    const result = await suggestForTicket(deps(), liza, id, model(complete), "op1");

    expect(result.ok && result.suggestion).toMatchObject({ category: "Delivery Issue", priority: "high", model: "m1" });
    const sent = complete.mock.calls[0][1];
    expect(sent).toContain("Subject: Leaking pouch");
    expect(sent).toContain("It leaks!");
    expect(sent).not.toMatch(/maria|0917|SECRET/i);
    expect((await latestSuggestion(db.sql, id))?.sentText).toBe(sent);
  });

  it("changes nothing on the Ticket until Staff act", async () => {
    const id = await ticket();
    await suggestForTicket(deps(), liza, id, model(async () => reply), "op1");

    const [t] = await db.sql`select category, priority from tickets where id = ${id}`;
    expect(t).toMatchObject({ category: "Other", priority: "normal" });
    expect(audit).not.toHaveBeenCalled();
  });

  it("Accept applies the suggested value and audits it with the Staff member's name", async () => {
    const id = await ticket();
    await suggestForTicket(deps(), liza, id, model(async () => reply), "op1");
    const s = (await latestSuggestion(db.sql, id))!;

    expect(await applyField(deps(), liza, id, "priority", "high", s.id, "op2")).toEqual({ ok: true });

    const [t] = await db.sql`select priority from tickets where id = ${id}`;
    expect(t.priority).toBe("high");
    expect((await latestSuggestion(db.sql, id))?.priorityDecision).toMatchObject({ kind: "accepted", applied: "high", by: "Liza" });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ticket.ai_priority_accepted", actor: expect.objectContaining({ id: "portal-liza", display_name: "Liza" }) }),
    );
  });

  it("Change applies another value and records that it differed", async () => {
    const id = await ticket();
    await suggestForTicket(deps(), liza, id, model(async () => reply), "op1");
    const s = (await latestSuggestion(db.sql, id))!;

    await applyField(deps(), liza, id, "category", "Payment Issue", s.id, "op2");

    const [t] = await db.sql`select category from tickets where id = ${id}`;
    expect(t.category).toBe("Payment Issue");
    expect((await latestSuggestion(db.sql, id))?.categoryDecision).toMatchObject({ kind: "changed", applied: "Payment Issue" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "ticket.ai_category_changed" }));
  });

  it("a model failure leaves the Ticket usable: falls back to the next model, then to manual fields", async () => {
    const id = await ticket();
    const bad = vi.fn(async () => { throw new Error("down"); });
    const garbage = vi.fn(async () => "no idea");

    expect(await suggestForTicket(deps(), liza, id, [{ model: "a", complete: bad }, { model: "b", complete: garbage }], "op1")).toEqual({ ok: false, reason: "model-failed" });
    expect(await suggestForTicket(deps(), liza, id, [], "op2")).toEqual({ ok: false, reason: "no-keys" });
    expect(await latestSuggestion(db.sql, id)).toBeNull();

    expect(await applyField(deps(), liza, id, "category", "Order Issue", null, "op3")).toEqual({ ok: true });
    const [t] = await db.sql`select category from tickets where id = ${id}`;
    expect(t.category).toBe("Order Issue");
  });

  it("a retry of the same operation does not ask the model again", async () => {
    const id = await ticket();
    const complete = vi.fn(async () => reply);
    await suggestForTicket(deps(), liza, id, model(complete), "op1");
    await suggestForTicket(deps(), liza, id, model(complete), "op1");

    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("refuses a completed Ticket and an unknown value", async () => {
    const done = await ticket("completed");
    expect(await suggestForTicket(deps(), liza, done, model(async () => reply), "op1")).toEqual({ ok: false, reason: "completed" });
    const id = await ticket();
    expect(await applyField(deps(), liza, id, "category", "Nonsense", null, "op2")).toEqual({ ok: false, reason: "invalid-value" });
    expect(await applyField(deps(), liza, done, "priority", "high", null, "op3")).toEqual({ ok: false, reason: "completed" });
  });
});

describe("helpers", () => {
  it("parses a fenced reply and rejects a bad one", () => {
    expect(parseSuggestion("```json\n" + reply + "\n```").priority).toBe("high");
    expect(() => parseSuggestion('{"category":"x","priority":"high"}')).toThrow();
  });

  it("caps long threads, keeping the newest Messages", () => {
    const text = ticketText("S", [{ sender: "customer", body: "a".repeat(5000) }, { sender: "customer", body: "NEWEST" }]);
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain("NEWEST");
  });
});
