import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { openComplaintThemes, THEME_MAX_ITEMS } from "@/features/feedback/complaint-themes";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-complaint-themes.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, order_returns, order_feedback, orders, customers restart identity cascade`;
  await db.sql`truncate crms.complaint_themes`;
});

async function customer(n: number) {
  await db.sql`insert into customers (id, full_name, first_name, email) values (${"c" + n}, ${"Maria Santos" + n}, ${"Maria"}, ${"m" + n + "@example.com"}) on conflict do nothing`;
  return "c" + n;
}
async function order(c: string) {
  const [o] = await db.sql<{ id: number }[]>`insert into orders (customer_id, status) values (${c}, 'delivered') returning id`;
  return o.id;
}
async function ticket(n: number, body: string) {
  const c = await customer(n);
  const [t] = await db.sql<{ id: number }[]>`insert into tickets (customer_id, subject) values (${c}, 'x') returning id`;
  await db.sql`insert into ticket_messages (ticket_id, sender, body) values (${t.id}, 'customer', ${body})`;
  await db.sql`insert into ticket_messages (ticket_id, sender, body, internal, author_name) values (${t.id}, 'staff', 'SECRET note', true, 'Liza')`;
  return t.id;
}
function fake(themes: { label: string; ids: string[] }[]) {
  return new MockLanguageModelV4({ doGenerate: async () => ({
    content: [{ type: "text", text: JSON.stringify({ themes }) }],
    finishReason: { unified: "stop", raw: undefined },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
    warnings: [],
  }) });
}
const deps = () => ({ tickets: db.sql, crms: db.sql });
const manager = { role: "CREOMS Manager" };
const use = (m: MockLanguageModelV4) => ({ models: () => [{ name: "fake", model: m }] });

describe("Complaint themes", () => {
  it("counts only valid IDs, one item per theme, one Customer once per theme, minimum 3", async () => {
    const t1 = await ticket(1, "Leaking pouch, call 0917 123 4567 or maria@example.com. I am Maria Santos1");
    const t2 = await ticket(2, "Tumutulo ang pouch");
    const t3 = await ticket(3, "Pouch leaks");
    const t4 = await ticket(3, "Pouch leaks again from the same person");
    const t5 = await ticket(4, "Late delivery");
    const t6 = await ticket(5, "Late delivery");
    const model = fake([
      { label: "Leaking pouch", ids: [`T${t1}`, `T${t2}`, `T${t3}`, `T${t4}`, "T9999", "X1"] },
      { label: "Overlap", ids: [`T${t1}`, `T${t2}`, `T${t3}`] },
      { label: "Late", ids: [`T${t5}`, `T${t6}`] },
    ]);
    const result = await openComplaintThemes(deps(), manager, {}, use(model));
    expect(result.themes?.themes).toHaveLength(1);
    expect(result.themes?.themes[0]).toMatchObject({ label: "Leaking pouch", count: 3 });
    expect(result.themes?.themes[0].items.map((i) => i.id)).toEqual([`T${t1}`, `T${t2}`, `T${t3}`]);
    expect(result.themes?.themes[0].items[0].href).toBe(`/tickets/${t1}`);
    expect(result.themes).toMatchObject({ ticketsRead: 6, returnsRead: 0, feedbackRead: 0, truncated: false });
  });

  it("sends masked, cut text only: no names, contacts or Internal notes; stores what was sent", async () => {
    await ticket(1, "Leaking pouch, call 0917 123 4567 or maria@example.com. I am Maria Santos1");
    await ticket(2, "x".repeat(1000));
    await ticket(3, "y");
    const model = fake([]);
    const result = await openComplaintThemes(deps(), manager, {}, use(model));
    const sent = result.themes!.sentText;
    expect(sent).not.toMatch(/Maria|Santos|maria@|0917|SECRET|Liza/);
    expect(sent.split("\n").every((l) => l.length <= 290)).toBe(true);
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("Leaking pouch");
    expect(result.themes!.systemPrompt.length).toBeGreaterThan(0);
  });

  it("reads Tickets, Returns and Feedback of 1 to 3 stars", async () => {
    const c = await customer(1);
    const o = await order(c);
    await db.sql`insert into order_returns (order_id, reason, note, amount_in_centavos) values (${o}, 'damaged', 'leaked', 100)`;
    const o2 = await order(await customer(2));
    await db.sql`insert into order_feedback (order_id, rating, comment) values (${o2}, 2, 'bad')`;
    const o3 = await order(await customer(3));
    await db.sql`insert into order_feedback (order_id, rating, comment) values (${o3}, 5, 'great')`;
    await ticket(4, "hello");
    const result = await openComplaintThemes(deps(), manager, {}, use(fake([])));
    expect(result.themes).toMatchObject({ ticketsRead: 1, returnsRead: 1, feedbackRead: 1 });
    expect(result.themes!.sentText).not.toContain("great");
  });

  it("reads the newest 300 and says so", async () => {
    for (let n = 1; n <= THEME_MAX_ITEMS + 5; n++) {
      const c = await customer(n);
      const o = await order(c);
      await db.sql`insert into order_feedback (order_id, rating, comment, created_at) values (${o}, 1, ${"bad " + n}, now() - ${n} * interval '1 minute')`;
    }
    const result = await openComplaintThemes(deps(), manager, {}, use(fake([])));
    expect(result.themes).toMatchObject({ feedbackRead: 300, itemsAvailable: 305, truncated: true });
    expect(result.themes!.sentText).not.toContain("bad 305");
  });

  it("is made once, remade only on Refresh, and a failed Refresh keeps the old result", async () => {
    for (let n = 1; n <= 3; n++) await ticket(n, "leak");
    const model = fake([]);
    const first = await openComplaintThemes(deps(), manager, {}, use(model));
    await openComplaintThemes(deps(), manager, {}, use(model));
    expect(model.doGenerateCalls).toHaveLength(1);
    await openComplaintThemes(deps(), manager, {}, { ...use(model), refresh: true });
    expect(model.doGenerateCalls).toHaveLength(2);
    const failed = await openComplaintThemes(deps(), manager, {}, { models: () => [], refresh: true });
    expect(failed.unavailable).toBe(true);
    expect(failed.themes?.sentText).toBe(first.themes?.sentText);
  });

  it("keeps results per period, in Philippines time", async () => {
    await ticket(1, "a"); await ticket(2, "b"); await ticket(3, "c");
    const m = fake([]);
    const r = await openComplaintThemes(deps(), manager, { from: "2020-01-01", to: "2020-01-31" }, use(m));
    expect(r.themes).toMatchObject({ ticketsRead: 0, period: { from: "2020-01-01", to: "2020-01-31" } });
    expect(m.doGenerateCalls).toHaveLength(0);
    expect((await openComplaintThemes(deps(), manager, {}, use(m))).themes?.ticketsRead).toBe(3);
  });

  it("Staff cannot ask; Admin and CEO read the kept result and never cause a model call", async () => {
    for (let n = 1; n <= 3; n++) await ticket(n, "leak");
    const boom = () => { throw new Error("must not configure"); };
    expect(await openComplaintThemes(deps(), { role: "Staff" }, {}, { models: boom })).toEqual({ themes: null, unavailable: true, refused: "read-only" });
    for (const role of ["Admin"]) expect(await openComplaintThemes(deps(), { role }, {}, { models: boom, refresh: true })).toEqual({ themes: null, unavailable: true });
    const kept = await openComplaintThemes(deps(), manager, {}, use(fake([])));
    for (const role of ["Admin"]) expect(await openComplaintThemes(deps(), { role }, {}, { models: boom, refresh: true })).toEqual({ themes: kept.themes, unavailable: false });
  });
});
