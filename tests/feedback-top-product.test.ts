import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAnalysis, type AuditEvent, type ModelClient, type Sentiment } from "@/features/feedback/analysis";
import { readTopProduct, type TopProductCandidate } from "@/features/feedback/top-product";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.sql`truncate feedback_top_product, feedback_analysis_runs, order_feedback, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Jane Doe', 'jane@example.com')`;
});

const NOW = new Date("2026-10-21T03:00:00Z");
const EARLIER = new Date("2026-10-20T03:00:00Z");
const SCHEDULE = { kind: "schedule" } as const;

/** A Feedback on a new Order of `products`, given before NOW and already labelled unless `labelled` is false. */
async function feedback(products: string[], { rating = 5, comment = "Good", labelled = true, at = EARLIER } = {}) {
  const [{ id }] = await db.sql<{ id: number }[]>`
    insert into orders (customer_id, status) values ('c1', 'delivered') returning id`;

  for (const product of products) {
    await db.sql`insert into order_lines (order_id, product_name) values (${id}, ${product})`;
  }

  await db.sql`
    insert into order_feedback (order_id, rating, comment, created_at, sentiment, sentiment_model)
    values (${id}, ${rating}, ${comment}, ${at}, ${labelled ? "positive" : null}, ${labelled ? "earlier-model" : null})`;

  return id;
}

async function many(count: number, products: string[], options?: Parameters<typeof feedback>[1]) {
  for (let i = 0; i < count; i += 1) await feedback(products, options);
}

type Choice = { product: string; reason: string };

/** A client that labels everything neutral and picks with `pick`, or fails to pick when it is null. */
function client(model: string, pick: ((candidates: TopProductCandidate[]) => Choice) | null): ModelClient & { offered: TopProductCandidate[][] } {
  const offered: TopProductCandidate[][] = [];

  return {
    model,
    offered,
    async classify(): Promise<Sentiment> {
      return "neutral";
    },
    async pickTopProduct(candidates) {
      offered.push(candidates);
      if (!pick) throw new Error(`${model} is down`);

      return pick(candidates);
    },
  };
}

const picks = (product: string, reason = "Customers love its texture.") => () => ({ product, reason });

const run = (groq: ModelClient | null, gemini: ModelClient | null = null, now = NOW, events: AuditEvent[] = []) =>
  runAnalysis({ sql: db.sql, groq, gemini, actor: SCHEDULE, audit: async (event) => void events.push(event), now });

describe("Top product in the analysis run", () => {
  it("offers only products with at least 5 Feedbacks, with each Feedback's rating and comment", async () => {
    await many(5, ["Halaya Smooth"], { comment: "Creamy" });
    await many(4, ["Ube Jam"]);
    const groq = client("groq-4", picks("Halaya Smooth"));

    await run(groq);

    expect(groq.offered).toHaveLength(1);
    expect(groq.offered[0].map((c) => c.product)).toEqual(["Halaya Smooth"]);
    expect(groq.offered[0][0].feedback).toHaveLength(5);
    expect(groq.offered[0][0].feedback[0]).toEqual({ rating: 5, comment: "Creamy" });
  });

  it("counts an Order with two products under both", async () => {
    await many(5, ["Halaya Smooth", "Ube Jam"]);
    const groq = client("groq-4", picks("Ube Jam"));

    await run(groq);

    expect(groq.offered[0].map((c) => c.product)).toEqual(["Halaya Smooth", "Ube Jam"]);
    expect(await readTopProduct(db.sql)).toMatchObject({ product: "Ube Jam", feedbackCount: 5 });
  });

  it("counts an Order once for a product with two lines on it", async () => {
    for (let i = 0; i < 4; i += 1) await feedback(["Halaya Smooth", "Halaya Smooth"]);
    const groq = client("groq-4", picks("Halaya Smooth"));

    await run(groq);

    expect(groq.offered).toEqual([]);
  });

  it("saves the product, its Feedback count, the reason, the model and the time", async () => {
    await many(6, ["Halaya Smooth"]);

    const result = await run(client("groq-4", picks("Halaya Smooth", "Customers praise how smooth it is.")));

    expect(result).toMatchObject({ status: "done", topProduct: "updated" });
    expect(await readTopProduct(db.sql)).toEqual({
      product: "Halaya Smooth",
      feedbackCount: 6,
      reason: "Customers praise how smooth it is.",
      model: "groq-4",
      computedAt: NOW,
    });
  });

  it("keeps the reason to one line", async () => {
    await many(5, ["Halaya Smooth"]);

    await run(client("groq-4", picks("Halaya Smooth", "  Smooth   and rich.\nAlso: more detail here.")));

    expect((await readTopProduct(db.sql))?.reason).toBe("Smooth and rich.");
  });

  it("uses Gemini when Groq fails, and records Gemini as the model", async () => {
    await many(5, ["Halaya Smooth"]);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await run(client("groq-4", null), client("gemini-2.5", picks("Halaya Smooth")));

    expect(await readTopProduct(db.sql)).toMatchObject({ product: "Halaya Smooth", model: "gemini-2.5" });
  });

  it("does not accept a product that was not offered", async () => {
    await many(5, ["Halaya Smooth"]);
    await many(2, ["Ube Jam"]);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await run(client("groq-4", picks("Ube Jam")), client("gemini-2.5", picks("Leche Flan")));

    expect(result).toMatchObject({ topProduct: "kept" });
    expect(await readTopProduct(db.sql)).toBeNull();
  });

  it("keeps the last result and its date when both models fail", async () => {
    await many(5, ["Halaya Smooth"]);
    await run(client("groq-4", picks("Halaya Smooth")));
    const before = await readTopProduct(db.sql);

    await many(5, ["Ube Jam"], { at: new Date(NOW.getTime() + 60_000) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const later = new Date(NOW.getTime() + 3 * 3_600_000);

    const result = await run(client("groq-4", null), client("gemini-2.5", null), later);

    expect(result).toMatchObject({ status: "done", topProduct: "kept" });
    expect(await readTopProduct(db.sql)).toEqual(before);
  });

  it("leaves no result, and asks no model, when no product has 5 Feedbacks", async () => {
    await many(4, ["Halaya Smooth"], { labelled: false });
    const groq = client("groq-4", picks("Halaya Smooth"));

    const result = await run(groq);

    expect(result).toMatchObject({ status: "done", analyzed: 4, topProduct: "not-enough" });
    expect(groq.offered).toEqual([]);
    expect(await readTopProduct(db.sql)).toBeNull();
  });

  it("recomputes at the end of a run that labelled Feedback, over the new labels' Feedback too", async () => {
    await many(4, ["Halaya Smooth"]);
    await feedback(["Halaya Smooth"], { labelled: false, at: NOW });
    const groq = client("groq-4", picks("Halaya Smooth"));

    const result = await run(groq);

    expect(result).toMatchObject({ analyzed: 1, topProduct: "updated" });
    expect(groq.offered[0][0].feedback).toHaveLength(5);
  });

  it("recomputes when every Feedback is labelled but there is Feedback newer than the result", async () => {
    await many(5, ["Halaya Smooth"]);
    await run(client("groq-4", picks("Halaya Smooth")));

    await many(5, ["Ube Jam"], { at: new Date(NOW.getTime() + 60_000) });
    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    const events: AuditEvent[] = [];

    const result = await run(client("groq-4", picks("Ube Jam")), null, later, events);

    expect(result).toMatchObject({ status: "done", analyzed: 0, failed: 0, topProduct: "updated" });
    expect(await readTopProduct(db.sql)).toMatchObject({ product: "Ube Jam", computedAt: later });
    expect(await db.sql`select 1 from feedback_analysis_runs`).toHaveLength(2);
    expect(events).toHaveLength(1);
  });

  it("does nothing when every Feedback is labelled and the result is current", async () => {
    await many(5, ["Halaya Smooth"]);
    await run(client("groq-4", picks("Halaya Smooth")));
    const groq = client("groq-4", picks("Halaya Smooth"));

    const result = await run(groq, null, new Date(NOW.getTime() + 3 * 3_600_000));

    expect(result).toEqual({ status: "nothing-to-do" });
    expect(groq.offered).toEqual([]);
  });

  it("is recomputed by Analyze too", async () => {
    await many(5, ["Halaya Smooth"]);

    const result = await runAnalysis({
      sql: db.sql,
      groq: client("groq-4", picks("Halaya Smooth")),
      gemini: null,
      actor: { kind: "staff", id: "s1", name: "Ana Staff" },
      audit: async () => {},
      cooldown: true,
      now: NOW,
    });

    expect(result).toMatchObject({ status: "done", topProduct: "updated" });
    expect(await readTopProduct(db.sql)).toMatchObject({ product: "Halaya Smooth" });
  });

  it("ignores any date: Feedback of every age counts", async () => {
    await many(3, ["Halaya Smooth"], { at: new Date("2025-01-01T00:00:00Z") });
    await many(2, ["Halaya Smooth"]);
    const groq = client("groq-4", picks("Halaya Smooth"));

    await run(groq);

    expect(groq.offered[0][0].feedback).toHaveLength(5);
  });
});
