import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { openProductAdvice } from "@/features/feedback/product-advice";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-feedback-product-advice.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate order_feedback, order_lines, orders, customers restart identity cascade`;
  await db.sql`truncate crms.feedback_product_advice`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Jane Doe', 'jane@example.com')`;
});

const NOW = new Date("2026-11-20T03:00:00Z");
const DAYS = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

async function feedback(products: string[], { rating = 5, comment = "Good", sentiment = null as string | null, at = DAYS(2) } = {}) {
  const [{ id }] = await db.sql<{ id: number }[]>`insert into orders (customer_id, status) values ('c1', 'delivered') returning id`;
  for (const product of products) await db.sql`insert into order_lines (order_id, product_name) values (${id}, ${product})`;
  await db.sql`insert into order_feedback (order_id, rating, comment, created_at, sentiment) values (${id}, ${rating}, ${comment}, ${at}, ${sentiment})`;
}
async function many(product: string, n: number, opts = {}) { for (let i = 0; i < n; i++) await feedback([product], opts); }

function fake(suggestions: { product: string; action: string; why: string }[]) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({ doGenerate: async (options) => {
    prompts.push(JSON.stringify(options.prompt));
    return {
      content: [{ type: "text", text: JSON.stringify({ suggestions }) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
      warnings: [],
    };
  } });
  return { model, prompts, models: () => [{ name: "fake", model }] };
}
const deps = () => ({ tickets: db.sql, crms: db.sql });
const manager = { role: "CREOMS Manager" };

describe("Feedback product advice", () => {
  it("ranks worst first, needs 5 Feedbacks, counts an Order once per product", async () => {
    await many("Halaya 500 g", 5, { rating: 1, sentiment: "negative" });
    await many("Ube jam", 5, { rating: 5, sentiment: "positive" });
    await many("Rare treat", 4, { rating: 1 });
    for (let i = 0; i < 5; i++) await feedback(["Combo A", "Combo A"], { rating: 3, sentiment: "neutral" });
    const ai = fake([]);

    const { result } = await openProductAdvice(deps(), manager, { generate: true, models: ai.models, now: NOW });

    expect(result!.products.map((p) => [p.rank, p.product, p.feedbackCount])).toEqual([[1, "Halaya 500 g", 5], [2, "Combo A", 5], [3, "Ube jam", 5]]);
    expect(result!.products[0].averageRating).toBe(1);
    expect(result!.products[0].negativeShare).toBe(1);
  });

  it("shows the trend against the previous 30 days", async () => {
    await many("Falling", 3, { rating: 2, at: DAYS(5) });
    await many("Falling", 3, { rating: 5, at: DAYS(40) });
    await many("Steady", 6, { rating: 4, at: DAYS(5) });

    const { result } = await openProductAdvice(deps(), manager, { generate: true, models: fake([]).models, now: NOW });

    expect(Object.fromEntries(result!.products.map((p) => [p.product, p.trend]))).toEqual({ Falling: "down", Steady: null });
  });

  it("keeps valid suggestions, drops unknown products and actions, and masks personal details in the prompt", async () => {
    await many("Halaya", 5, { rating: 1, comment: "Leaks! Call 0917 123 4567 or jane@example.com" });
    const ai = fake([
      { product: "Halaya", action: "check-batch", why: "Leaking pouches are repeated." },
      { product: "Invented", action: "keep", why: "x" },
      { product: "Halaya", action: "refund-everyone", why: "x" },
    ]);

    const { result } = await openProductAdvice(deps(), manager, { generate: true, models: ai.models, now: NOW });

    expect(result!.products).toHaveLength(1);
    expect(result!.products[0].advice).toEqual({ action: "check-batch", label: "Check the batch or packaging", why: "Leaking pouches are repeated." });
    expect(ai.prompts.join("")).not.toContain("jane@example.com");
    expect(ai.prompts.join("")).not.toContain("0917");
  });

  it("still ranks, with no suggestions, when no model works, and keeps the result for later reading", async () => {
    await many("Halaya", 5, { rating: 1 });

    const made = await openProductAdvice(deps(), { role: "Staff" }, { generate: true, models: () => [], now: NOW });
    expect(made.result!.adviceUnavailable).toBe(true);
    expect(made.result!.products[0].advice).toBeNull();

    const ai = fake([]);
    const read = await openProductAdvice(deps(), { role: "Admin" }, { generate: true, models: ai.models, now: NOW });
    expect(read.result!.products[0].product).toBe("Halaya");
    expect(ai.model.doGenerateCalls).toHaveLength(0);
  });

  it("lets Admin and the CEO read only, and refuses an unknown Role", async () => {
    await many("Halaya", 5, { rating: 1 });
    const ai = fake([]);

    const empty = await openProductAdvice(deps(), { role: "Admin" }, { generate: true, models: ai.models, now: NOW });
    expect(empty).toEqual({ result: null, unavailable: false });
    expect(ai.model.doGenerateCalls).toHaveLength(0);

    expect(await openProductAdvice(deps(), { role: "Customer" }, { generate: true, models: ai.models })).toMatchObject({ result: null, refused: "read-only" });
  });
});
