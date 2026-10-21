import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FEEDBACK_PAGE_SIZE, listFeedback, loadFeedback } from "@/features/feedback/feedback";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.sql`truncate feedback_analysis_runs, feedback_requests, order_feedback, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values
    ('c1', 'Jane Doe', 'jane@example.com'), ('c2', 'Ramon Cruz', 'ramon@example.com')`;
});

/** An Order with its product names and, when given, Feedback left on `given`. */
async function order(options: { customer?: string; products?: string[]; rating?: number; comment?: string; given?: string }) {
  const [row] = await db.sql<{ id: number }[]>`
    insert into orders (customer_id, status) values (${options.customer ?? "c1"}, 'delivered') returning id`;

  for (const name of options.products ?? ["Ube Jam"]) {
    await db.sql`insert into order_lines (order_id, product_name) values (${row.id}, ${name})`;
  }

  if (options.rating !== undefined) {
    await db.sql`
      insert into order_feedback (order_id, rating, comment, created_at)
      values (${row.id}, ${options.rating}, ${options.comment ?? "Nice"}, ${options.given ?? "2026-10-01T00:00:00Z"})`;
  }

  return row.id;
}

describe("Sentiment and Last analyzed", () => {
  it("gives each row its Sentiment, or null until it is labelled", async () => {
    const labelled = await order({ rating: 5, given: "2026-10-05T00:00:00Z" });
    const waiting = await order({ rating: 2, given: "2026-10-01T00:00:00Z" });
    await db.sql`update order_feedback set sentiment = 'positive', sentiment_model = 'groq-4' where order_id = ${labelled}`;

    const { rows } = await listFeedback(db.sql);

    expect(rows.find((r) => r.orderId === labelled)?.sentiment).toBe("positive");
    expect(rows.find((r) => r.orderId === waiting)?.sentiment).toBeNull();
  });

  it("is null for Last analyzed until a run has finished", async () => {
    await db.sql`insert into feedback_analysis_runs (started_by_kind) values ('schedule')`;

    expect((await listFeedback(db.sql)).lastAnalyzed).toBeNull();
  });

  it("is the finish time of the latest finished run that labelled something", async () => {
    await db.sql`insert into feedback_analysis_runs (started_by_kind, finished_at, analyzed) values
      ('schedule', '2026-10-20T03:00:00Z', 2), ('schedule', '2026-10-21T06:00:00Z', 1),
      ('schedule', '2026-10-21T09:00:00Z', 0), ('schedule', null, 0)`;

    expect((await listFeedback(db.sql)).lastAnalyzed).toEqual(new Date("2026-10-21T06:00:00Z"));
  });
});

describe("listFeedback", () => {
  it("is empty when no Order has Feedback", async () => {
    await order({});

    expect(await listFeedback(db.sql)).toMatchObject({ rows: [], total: 0, page: 1, totalPages: 1 });
  });

  it("shows stars, Customer, Order, products, comment and date, newest first", async () => {
    const older = await order({ rating: 5, comment: "Perfect", given: "2026-10-01T00:00:00Z" });
    const newer = await order({ customer: "c2", rating: 2, comment: "Too sweet", given: "2026-10-05T00:00:00Z" });

    const { rows } = await listFeedback(db.sql);

    expect(rows.map((r) => r.orderId)).toEqual([newer, older]);
    expect(rows[0]).toMatchObject({
      rating: 2,
      comment: "Too sweet",
      customerId: "c2",
      customerName: "Ramon Cruz",
      products: ["Ube Jam"],
      createdAt: new Date("2026-10-05T00:00:00Z"),
    });
  });

  it("lists every product of an Order once, in the order they were added", async () => {
    await order({ products: ["Smooth tub", "Tidbits pouch"], rating: 5 });

    expect((await listFeedback(db.sql)).rows[0].products).toEqual(["Smooth tub", "Tidbits pouch"]);
  });

  it("pages 25 at a time and clamps a page past the end", async () => {
    for (let i = 0; i < FEEDBACK_PAGE_SIZE + 2; i++) {
      await order({ rating: 4, given: `2026-10-01T00:${String(i).padStart(2, "0")}:00Z` });
    }

    const first = await listFeedback(db.sql, { page: 1 });
    const second = await listFeedback(db.sql, { page: 2 });
    const past = await listFeedback(db.sql, { page: 9 });

    expect(first.rows).toHaveLength(25);
    expect(first.totalPages).toBe(2);
    expect(second.rows).toHaveLength(2);
    expect(past.page).toBe(2);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.orderId)).size).toBe(27);
  });
});

describe("the date range", () => {
  it("is inclusive of both days, counted in Philippines time", async () => {
    // 2026-10-05 00:00 in Manila is 2026-10-04T16:00Z; 2026-10-07 ends at 2026-10-07T15:59:59Z.
    const before = await order({ rating: 5, given: "2026-10-04T15:59:59Z" });
    const start = await order({ rating: 5, given: "2026-10-04T16:00:00Z" });
    const end = await order({ rating: 5, given: "2026-10-07T15:59:59Z" });
    const after = await order({ rating: 5, given: "2026-10-07T16:00:00Z" });

    const { rows } = await listFeedback(db.sql, { from: "2026-10-05", to: "2026-10-07" });

    expect(rows.map((r) => r.orderId).sort()).toEqual([start, end].sort());
    expect(rows.map((r) => r.orderId)).not.toContain(before);
    expect(rows.map((r) => r.orderId)).not.toContain(after);
  });

  it("is open-ended when only one side is given", async () => {
    const early = await order({ rating: 4, given: "2026-09-01T00:00:00Z" });
    const late = await order({ rating: 4, given: "2026-10-20T00:00:00Z" });

    expect((await listFeedback(db.sql, { from: "2026-10-01" })).rows.map((r) => r.orderId)).toEqual([late]);
    expect((await listFeedback(db.sql, { to: "2026-10-01" })).rows.map((r) => r.orderId)).toEqual([early]);
  });

  it("pages within the range", async () => {
    for (let i = 0; i < FEEDBACK_PAGE_SIZE + 1; i++) await order({ rating: 4, given: "2026-10-05T00:00:00Z" });
    await order({ rating: 4, given: "2026-01-01T00:00:00Z" });

    const list = await listFeedback(db.sql, { from: "2026-10-01", page: 2 });

    expect(list).toMatchObject({ total: 26, totalPages: 2 });
    expect(list.rows).toHaveLength(1);
  });
});

describe("the star filter", () => {
  it("narrows the list to one rating", async () => {
    await order({ rating: 5 });
    const three = await order({ rating: 3 });

    const list = await listFeedback(db.sql, { stars: 3 });

    expect(list.rows.map((r) => r.orderId)).toEqual([three]);
    expect(list.total).toBe(1);
  });
});

describe("the product filter", () => {
  it("lists the Feedback of every Order that contained the product, so a two-product Order appears under both", async () => {
    const both = await order({ products: ["Smooth tub", "Tidbits pouch"], rating: 5 });
    const tidbitsOnly = await order({ products: ["Tidbits pouch"], rating: 3 });
    await order({ products: ["Ube Jam"], rating: 4 });

    const tub = await listFeedback(db.sql, { product: "Smooth tub" });
    const tidbits = await listFeedback(db.sql, { product: "Tidbits pouch" });

    expect(tub.rows.map((r) => r.orderId)).toEqual([both]);
    expect(tidbits.rows.map((r) => r.orderId).sort()).toEqual([both, tidbitsOnly].sort());
    expect(tidbits.total).toBe(2);
    // The row still shows everything on the Order.
    expect(tub.rows[0].products).toEqual(["Smooth tub", "Tidbits pouch"]);
  });

  it("counts an Order once when it has two lines of the product", async () => {
    await order({ products: ["Smooth tub", "Smooth tub"], rating: 5 });

    expect((await listFeedback(db.sql, { product: "Smooth tub" })).total).toBe(1);
  });

  it("combines with the date range and the star filter", async () => {
    await order({ products: ["Smooth tub"], rating: 5, given: "2026-01-01T00:00:00Z" });
    const hit = await order({ products: ["Smooth tub"], rating: 2, given: "2026-10-05T00:00:00Z" });
    await order({ products: ["Smooth tub"], rating: 5, given: "2026-10-06T00:00:00Z" });
    await order({ products: ["Ube Jam"], rating: 2, given: "2026-10-05T00:00:00Z" });

    const list = await listFeedback(db.sql, { product: "Smooth tub", from: "2026-10-01", stars: 2 });

    expect(list.rows.map((r) => r.orderId)).toEqual([hit]);
  });

  it("matches nothing for a product with no Feedback", async () => {
    await order({ rating: 5 });

    expect(await listFeedback(db.sql, { product: "Nope" })).toMatchObject({ rows: [], total: 0 });
  });

  it("leaves the cards on every Feedback, so no per-product average appears", async () => {
    await order({ products: ["Smooth tub"], rating: 5 });
    await order({ products: ["Ube Jam"], rating: 1 });

    const list = await listFeedback(db.sql, { product: "Smooth tub" });

    expect(list.summary).toEqual({ count: 2, average: 3, low: 1 });
  });

  it("offers every product that has Feedback, alphabetically, whatever the filters", async () => {
    await order({ products: ["Tidbits pouch", "Smooth tub"], rating: 5 });
    await order({ products: ["Ube Jam"], rating: 1 });
    await order({ products: ["Never reviewed"] });

    expect((await listFeedback(db.sql, { stars: 5 })).products).toEqual(["Smooth tub", "Tidbits pouch", "Ube Jam"]);
  });
});

describe("the summary", () => {
  it("is empty with no average when nothing matches", async () => {
    expect((await listFeedback(db.sql)).summary).toEqual({ count: 0, average: null, low: 0 });
  });

  it("averages every Feedback and counts the 1 to 3 star ones as low", async () => {
    for (const rating of [5, 4, 3, 1]) await order({ rating });

    expect((await listFeedback(db.sql)).summary).toEqual({ count: 4, average: 3.3, low: 2 });
  });

  it("rounds the average to one decimal, halves going up", async () => {
    for (const rating of [5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]) {
      await order({ rating });
    }

    expect((await listFeedback(db.sql)).summary.average).toBe(4.2);
  });

  it("follows the date range and the star filter, not the page", async () => {
    await order({ rating: 5, given: "2026-01-01T00:00:00Z" });
    await order({ rating: 2, given: "2026-10-05T00:00:00Z" });
    await order({ rating: 4, given: "2026-10-06T00:00:00Z" });

    expect((await listFeedback(db.sql, { from: "2026-10-01" })).summary).toEqual({ count: 2, average: 3, low: 1 });
    expect((await listFeedback(db.sql, { from: "2026-10-01", stars: 4 })).summary).toEqual({
      count: 1,
      average: 4,
      low: 0,
    });
  });
});

describe("the response rate", () => {
  /** A delivered Order with a Feedback request sent on `sent` and, when `rating` is given, Feedback left on `given`. */
  async function requested(options: { sent: string; rating?: number; given?: string }) {
    const id = await order({ rating: options.rating, given: options.given });

    await db.sql`insert into feedback_requests (order_id, customer_id, sent_at) values (${id}, 'c1', ${options.sent})`;

    return id;
  }

  it("has no rate when no request was sent", async () => {
    expect((await listFeedback(db.sql)).response).toEqual({ requested: 0, received: 0, rate: null });
  });

  it("is the Feedback received over the requests sent, as a whole percent", async () => {
    await requested({ sent: "2026-10-01T00:00:00Z", rating: 5, given: "2026-10-02T00:00:00Z" });
    await requested({ sent: "2026-10-01T00:00:00Z" });
    await requested({ sent: "2026-10-01T00:00:00Z" });

    expect((await listFeedback(db.sql)).response).toEqual({ requested: 3, received: 1, rate: 33 });
  });

  it("leaves out Feedback on Orders with no request record, from both numbers", async () => {
    await requested({ sent: "2026-10-01T00:00:00Z", rating: 4, given: "2026-10-02T00:00:00Z" });
    await order({ rating: 5, given: "2026-10-02T00:00:00Z" });

    expect((await listFeedback(db.sql)).response).toEqual({ requested: 1, received: 1, rate: 100 });
  });

  it("counts requests by when they were sent and Feedback by when it was given, in the date range", async () => {
    await requested({ sent: "2026-01-01T00:00:00Z", rating: 5, given: "2026-01-02T00:00:00Z" });
    await requested({ sent: "2026-10-05T00:00:00Z", rating: 3, given: "2026-10-06T00:00:00Z" });
    await requested({ sent: "2026-10-06T00:00:00Z" });

    expect((await listFeedback(db.sql, { from: "2026-10-01", to: "2026-10-31" })).response).toEqual({
      requested: 2,
      received: 1,
      rate: 50,
    });
  });

  it("ignores the star and product filters", async () => {
    await requested({ sent: "2026-10-01T00:00:00Z", rating: 5, given: "2026-10-02T00:00:00Z" });
    await requested({ sent: "2026-10-01T00:00:00Z" });

    expect((await listFeedback(db.sql, { stars: 1, product: "Nothing" })).response).toEqual({
      requested: 2,
      received: 1,
      rate: 50,
    });
  });
});

describe("loadFeedback", () => {
  it("reports an unreachable database instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await loadFeedback(() => {
        throw new Error("down");
      }, {}),
    ).toEqual({ ok: false });
  });
});
