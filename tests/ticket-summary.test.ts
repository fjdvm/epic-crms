import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { openTicketSummary } from "@/features/tickets/summary";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-ticket-summaries.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, customers restart identity cascade`;
  await db.sql`truncate crms.ticket_summaries`;
  await db.sql`insert into customers (id, full_name, first_name, email) values ('c1', 'Maria Santos', 'Maria', 'maria@example.com')`;
});
async function ticket() {
  const [row] = await db.sql<{ id: number }[]>`insert into tickets (customer_id, subject) values ('c1', 'Leaking pouch') returning id`;
  await db.sql`insert into ticket_messages (ticket_id, sender, body) values (${row.id}, 'customer', 'I am Maria Santos. My pouch leaks. Email maria@example.com or 0917 123 4567.')`;
  await db.sql`insert into ticket_messages (ticket_id, sender, body, internal, author_name) values (${row.id}, 'staff', 'SECRET diagnosis', true, 'Liza')`;
  return row.id;
}
function fake(text = "The Customer reports a leaking pouch.") {
  return new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: "text", text: JSON.stringify({ summary: text }) }],
    finishReason: { unified: "stop", raw: undefined },
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 10, text: 10, reasoning: undefined } },
    warnings: [],
  }) });
}
const deps = () => ({ tickets: db.sql, crms: db.sql });
const staff = { role: "Staff" };

describe("Ticket summary on open", () => {
  it("keeps the summary and exact masked input for a later open without another model call", async () => {
    const id = await ticket();
    const model = fake();
    const models = () => [{ name: "fake", model }];
    const made = await openTicketSummary(deps(), staff, id, models);
    expect(made.summary).toMatchObject({ text: "The Customer reports a leaking pouch.", model: "fake" });
    expect(made.summary?.sentText).toContain("My pouch leaks.");
    expect(made.summary?.sentText).not.toMatch(/Maria|Santos|maria@|0917|SECRET|Liza/);
    expect(await openTicketSummary(deps(), staff, id, models)).toEqual(made);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].prompt).toContainEqual({ role: "user", content: [{ type: "text", text: made.summary?.sentText }] });
  });
  it("remakes only after a public Message and a Staff or Manager open; read-only Roles only read", async () => {
    const id = await ticket();
    const model = fake();
    const models = () => [{ name: "fake", model }];
    for (const role of ["Admin", "CEO", "unknown"]) {
      expect(await openTicketSummary(deps(), { role }, id, () => { throw new Error("must not configure"); })).toEqual({ summary: null, unavailable: true });
    }
    const kept = await openTicketSummary(deps(), { role: "CREOMS Manager" }, id, models);
    await db.sql`insert into ticket_messages (ticket_id, sender, body, internal) values (${id}, 'staff', 'Internal note only', true)`;
    expect(await openTicketSummary(deps(), staff, id, models)).toEqual(kept);
    expect(model.doGenerateCalls).toHaveLength(1);
    await db.sql`insert into ticket_messages (ticket_id, sender, body) values (${id}, 'staff', 'We asked for a photo.')`;
    for (const role of ["Admin", "CEO"]) {
      expect(await openTicketSummary(deps(), { role }, id, () => { throw new Error("must not configure"); })).toEqual(kept);
    }
    const refreshed = await openTicketSummary(deps(), staff, id, models);
    expect(refreshed.summary?.sentText).toContain("We asked for a photo.");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(await openTicketSummary(deps(), { role: "CEO" }, id, models)).toEqual(refreshed);
  });
  it("a missing key or failed model leaves manual Ticket work usable and retains any older summary", async () => {
    const id = await ticket();
    expect(await openTicketSummary(deps(), staff, id, () => [])).toEqual({ summary: null, unavailable: true });
    const bad = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("down"); } });
    expect(await openTicketSummary(deps(), staff, id, () => [{ name: "bad", model: bad }])).toEqual({ summary: null, unavailable: true });
    const made = await openTicketSummary(deps(), staff, id, () => [{ name: "fake", model: fake() }]);
    await db.sql`insert into ticket_messages (ticket_id, sender, body) values (${id}, 'customer', 'Another pouch leaks.')`;
    expect(await openTicketSummary(deps(), staff, id, () => [])).toEqual({ summary: made.summary, unavailable: true });
    const [record] = await db.sql`select status, category, priority from tickets where id = ${id}`;
    expect(record).toMatchObject({ status: "open", category: "Other", priority: "normal" });
  });

  it("redacts known names and a pasted delivery address without sending Order details", async () => {
    const id = await ticket();
    const [order] = await db.sql`insert into orders (customer_id, subtotal_in_centavos) values ('c1', 987654) returning id`;
    await db.sql`insert into order_delivery_addresses (order_id, street, barangay, city, province, postal_code)
      values (${order.id}, '123 Private Street', 'Secret Barangay', 'Antipolo', 'Rizal', '1870')`;
    await db.sql`update tickets set order_id = ${order.id}, claimed_by_name = 'Ralph Perez' where id = ${id}`;
    await db.sql`insert into ticket_messages (ticket_id, sender, body) values (${id}, 'staff', 'Ralph here. Hello Santos.')`;
    await db.sql`insert into ticket_messages (ticket_id, sender, author_name, body)
      values (${id}, 'staff', 'Bernice Cruz', 'Hi Maria, Bernice Cruz here. Is your address 123 Private Street, Secret Barangay, Antipolo, Rizal 1870?')`;
    const result = await openTicketSummary(deps(), staff, id, () => [{ name: "fake", model: fake() }]);
    expect(result.summary?.sentText).toContain("Is your address");
    expect(result.summary?.sentText).not.toMatch(/Maria|Santos|Bernice|Cruz|Ralph|Perez|123 Private|Secret Barangay|Antipolo|Rizal|1870|987654/);
  });
  it("two simultaneous opens reuse the kept result and make only one summary", async () => {
    const id = await ticket();
    const model = fake();
    const models = () => [{ name: "fake", model }];
    const results = await Promise.all([openTicketSummary(deps(), staff, id, models), openTicketSummary(deps(), staff, id, models)]);
    expect(results.every((r) => r.summary?.text === "The Customer reports a leaking pouch.")).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

});
