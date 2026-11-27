import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { loadLatestRun, runInsights, SYSTEM } from "@/features/ai-insights/run";
import { answerInsight, dismissInsight, loadEvidence, viewerState } from "@/features/ai-insights/store";
import * as structured from "@/lib/ai/structured";
import type { AuditEvent } from "@/lib/audit-trail";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date("2026-11-24T22:00:00Z"); // 6:00 am, 25 Nov in Manila
const person = (role: string, id = "s1") => ({ id, name: "Rhea", role });
const manager = person("CREOMS Manager");
const ceo = person("CEO", "s2");
const admin = person("Admin", "a1");
const staff = person("Staff / Employee", "s9");
const ALL = ["Orders", "Payments", "Fulfilment", "Returns", "Tickets"];
const models = () => [{ name: "m", model: {} as never }];
const sources = () => ({ source: db.sql, crms: db.sql });
let spy: MockInstance<(args: { system: string; prompt: string }) => Promise<unknown>>;
let audited: AuditEvent[];
const audit = async (event: AuditEvent) => { audited.push(event); };

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`alter table orders add column confirmed_at timestamptz, add column payment_deadline_at timestamptz`;
  await db.sql`create schema crms`;
  await db.sql`create table crms.stock_count (ims_product_id integer primary key, name text not null, variant text, active boolean not null default true, available integer)`;
  await db.sql`create table products (slug text primary key, name text not null)`;
  await db.sql`create table sizes (id integer primary key generated always as identity, product_slug text not null, label text not null, ims_product_id integer)`;
  for (const file of ["crms-complaint-themes", "crms-ai-insights", "crms-ai-insights-runs"])
    await db.sql.unsafe(readFileSync(`docs/db/${file}.sql`, "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  vi.restoreAllMocks();
  audited = [];
  await db.sql`truncate crms.ai_insight_runs, crms.ai_insight_decisions, crms.complaint_themes, failed_deliveries, order_returns, ticket_messages, tickets, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
  spy = (vi.spyOn(structured, "structuredOutput") as unknown as typeof spy).mockImplementation(async ({ system }) =>
    system === SYSTEM
      ? { ok: true, model: "m", output: { summary: "Orders reached 31 this week. Two unpaid Orders need a look first.", notes: [
        { n: 1, note: "These 2 Orders cancel soon; a reminder may save them." },
      ] } }
      : { ok: true, model: "m", output: { themes: [] } });
});

async function orders(count: number) {
  await db.sql`insert into orders (customer_id, created_at, status, payment_method, subtotal_in_centavos, paid_at, fulfillment_method)
    select 'c1', ${new Date("2026-11-22T02:00:00Z")}, 'paid', 'gcash', 10000, ${new Date("2026-11-22T02:00:00Z")}, 'pickup' from generate_series(1, ${count})`;
}
async function expiring() {
  const rows = await db.sql<{ id: number }[]>`insert into orders (customer_id, status, payment_method, subtotal_in_centavos, payment_deadline_at)
    values ('c1', 'confirmed', 'gcash', 25000, ${new Date("2026-11-25T08:00:00Z")}), ('c1', 'confirmed', 'maya', 25000, ${new Date("2026-11-25T09:00:00Z")}) returning id`;
  return rows.map((r) => r.id);
}

describe("the morning run", () => {
  it("stores both periods, with the AI's wording kept only when it quotes the facts' own numbers", async () => {
    await orders(31);
    await db.sql`insert into order_lines (order_id, product_name, size_label, quantity, price_in_centavos) values (1, 'Ube Jam', '250 g', 2, 15000)`;
    const ids = await expiring();
    const result = await runInsights(sources(), now, models);
    expect(result).toEqual([
      { days: 7, enoughData: true, insights: 1, worded: true },
      { days: 30, enoughData: true, insights: 1, worded: true },
    ]);
    const run = (await loadLatestRun(db.sql, 7))!;
    expect(run).toMatchObject({ days: 7, enoughData: true, orders: 31, summary: "Orders reached 31 this week. Two unpaid Orders need a look first.", summaryConfidence: "low" });
    expect(run.createdAt).toBe(now.toISOString());
    // Products are stored with the run's figures, for Top products and each area's favourite.
    expect(run.products).toEqual([
      expect.objectContaining({ scope: "all", product: "Ube Jam", size: null, units: 2, value: 30000, orders: 1 }),
      expect.objectContaining({ scope: "all", product: "Ube Jam", size: "250 g", units: 2 }),
    ]);
    expect(run.insights[0]).toMatchObject({ key: "payments:expiring", ai: "These 2 Orders cancel soon; a reminder may save them.", records: ids.map((id) => ({ type: "order", id })) });

    // The prompt holds aggregates and the cards' own text; never a Customer.
    const prompt = String(spy.mock.calls.find(([a]) => a.system === SYSTEM)![0].prompt);
    expect(prompt).toContain("Period: the last 7 days");
    expect(prompt).not.toMatch(/Maria|maria@example\.com|c1/);
    const [row] = await db.sql`select sent_text, system_prompt, model from crms.ai_insight_runs where period_days = 7`;
    expect(row).toEqual({ sent_text: prompt, system_prompt: SYSTEM, model: "m" });
  });

  it("throws away a summary or note that quotes a number the facts do not hold", async () => {
    await orders(31);
    await expiring();
    spy.mockImplementation(async ({ system }) => system === SYSTEM
      ? { ok: true, model: "m", output: { summary: "Orders rose 48% this week.", notes: [{ n: 1, note: "About 9 Orders will cancel; see https://example.com." }] } }
      : { ok: true, model: "m", output: { themes: [] } });
    await runInsights(sources(), now, models);
    const run = (await loadLatestRun(db.sql, 7))!;
    expect(run.summary).toBeNull();
    expect(run.insights[0].ai).toBeNull();
    expect(run.insights[0].nextStep).toMatch(/Message these Customers/);
  });

  it("with fewer than 30 Orders, stores 'not enough data' without asking a model or making any insight", async () => {
    await orders(12);
    await expiring();
    await runInsights(sources(), now, models);
    const run = (await loadLatestRun(db.sql, 7))!;
    expect(run).toMatchObject({ enoughData: false, orders: 12, insights: [], summary: null });
    expect(spy).not.toHaveBeenCalled(); // neither the wording nor the Ticket themes
    expect(run.stats.orders.value).toBe(12); // real figures stay visible; only the judgements wait for 30
  });

  it("keeps the cards when no model answers, and a rerun the same day replaces the run", async () => {
    await orders(31);
    await expiring();
    spy.mockResolvedValue({ ok: false, reason: "no-keys" });
    await runInsights(sources(), now, models);
    await runInsights(sources(), new Date(now.getTime() + 60_000), models);
    const [{ count }] = await db.sql`select count(*)::int as count from crms.ai_insight_runs`;
    expect(count).toBe(2);
    expect((await loadLatestRun(db.sql, 7))!).toMatchObject({ summary: null, insights: [{ key: "payments:expiring", ai: null }] });
  });
});

describe("per person", () => {
  beforeEach(async () => {
    await orders(31);
    await expiring();
    await runInsights(sources(), now, models);
  });

  it("lets Managers, the CEO and Admin dismiss for themselves, logged with their name; Staff are refused", async () => {
    expect(await dismissInsight(db.sql, audit, manager, ["Payments"], 7, "payments:expiring", now)).toEqual({ ok: true });
    expect(audited[0]).toMatchObject({ action: "ai_insight.dismissed", actor: { id: "s1", display_name: "Rhea" }, target: { id: "payments:expiring" } });
    expect(await dismissInsight(db.sql, audit, admin, ["Payments"], 7, "payments:expiring", now)).toEqual({ ok: true });
    expect(await dismissInsight(db.sql, audit, staff, ["Payments"], 7, "payments:expiring", now)).toEqual({ ok: false, reason: "Your Role cannot open AI insights." });

    const run = (await loadLatestRun(db.sql, 7))!;
    expect((await viewerState(db.sql, manager, run)).dismissed.get("payments:expiring")).toEqual({ orders: 2 });
    expect((await viewerState(db.sql, ceo, run)).dismissed.size).toBe(0);
  });

  it("refuses a card from a Module the person does not hold, or one that is no longer in the run", async () => {
    expect(await dismissInsight(db.sql, audit, manager, ["Orders"], 7, "payments:expiring", now)).toEqual({ ok: false, reason: "This insight is not in your Modules." });
    expect((await answerInsight(db.sql, manager, ALL, 7, "stock:missing", true)).ok).toBe(false);
  });

  it("keeps one Helpful / Not helpful answer per person and run", async () => {
    expect(await answerInsight(db.sql, ceo, ALL, 7, "payments:expiring", true)).toEqual({ ok: true });
    expect(await answerInsight(db.sql, ceo, ALL, 7, "payments:expiring", false)).toEqual({ ok: true });
    expect(await answerInsight(db.sql, admin, ALL, 7, "payments:expiring", true)).toEqual({ ok: true });
    const run = (await loadLatestRun(db.sql, 7))!;
    expect((await viewerState(db.sql, ceo, run)).answers).toEqual({ "payments:expiring": false });
    const [row] = await db.sql`select staff_name from crms.ai_insight_feedback where staff_id = 's2'`;
    expect(row.staff_name).toBe("Rhea");
  });

  it("reads the evidence now, with names only for the person on the page", async () => {
    const result = await loadEvidence(sources(), manager, ALL, 7, "payments:expiring");
    expect(result).toEqual({ ok: true, records: [
      { type: "order", id: 32, label: "Order #32", detail: "Maria Santos", status: "Confirmed", href: "/orders/32" },
      { type: "order", id: 33, label: "Order #33", detail: "Maria Santos", status: "Confirmed", href: "/orders/33" },
    ] });
    expect((await loadEvidence(sources(), staff, ALL, 7, "payments:expiring")).ok).toBe(false);
  });
});

describe("Feedback cards", () => {
  it("stores a low-ratings card and shows its Feedback as evidence, only to people with the Feedback Module", async () => {
    await orders(31);
    const ratings = [1, 2, 5, 5, 5, 2];
    for (const [i, rating] of ratings.entries()) {
      await db.sql`insert into order_lines (order_id, product_name, size_label, quantity, price_in_centavos) values (${i + 1}, 'Halaya', '', 1, 20000)`;
      await db.sql`insert into order_feedback (order_id, rating, comment, created_at)
        values (${i + 1}, ${rating}, ${rating <= 3 ? "Dumating na sira ang garapon" : "Masarap"}, ${new Date("2026-11-22T03:00:00Z")})`;
    }
    await runInsights(sources(), now, models);
    const run = (await loadLatestRun(db.sql, 7))!;
    expect(run.insights.find((i) => i.key === "feedback:low:halaya")).toMatchObject({
      category: "feedback", module: "Feedback", priority: "high", headline: "Low ratings on Halaya: 3 of 6",
      records: [{ type: "feedback", id: 6 }, { type: "feedback", id: 2 }, { type: "feedback", id: 1 }],
    });
    expect(run.stats.rating).toMatchObject({ value: 3.3 });

    const result = await loadEvidence(sources(), manager, [...ALL, "Feedback"], 7, "feedback:low:halaya");
    expect(result).toEqual({ ok: true, records: [6, 2, 1].map((id) => ({
      type: "feedback", id, label: `${id === 1 ? "★☆☆☆☆" : "★★☆☆☆"} Order #${id}`, detail: "Maria Santos · “Dumating na sira ang garapon”",
      status: id === 1 ? "1 star" : "2 stars", href: `/customer-profiles/c1#order-${id}`,
    })) });
    expect((await loadEvidence(sources(), manager, ALL, 7, "feedback:low:halaya")).ok).toBe(false);
  });
});
