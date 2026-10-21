import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runAnalysis,
  type AuditEvent,
  type Sentiment,
  type SentimentClient,
} from "@/features/feedback/analysis";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.sql`truncate feedback_analysis_runs, order_feedback, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Jane Doe', 'jane@example.com')`;
});

async function feedback(comment: string, rating = 4, labelled?: Sentiment) {
  const [{ id }] = await db.sql<{ id: number }[]>`
    insert into orders (customer_id, status) values ('c1', 'delivered') returning id`;
  await db.sql`
    insert into order_feedback (order_id, rating, comment, sentiment, sentiment_model, sentiment_analyzed_at)
    values (${id}, ${rating}, ${comment}, ${labelled ?? null}, ${labelled ? "earlier-model" : null},
      ${labelled ? "2026-10-01T00:00:00Z" : null})`;

  return id;
}

const stored = (orderId: number) =>
  db.sql<{ sentiment: string | null; sentiment_model: string | null; sentiment_analyzed_at: Date | null }[]>`
    select sentiment, sentiment_model, sentiment_analyzed_at from order_feedback where order_id = ${orderId}`.then((r) => r[0]);

/** A client that answers from `answers` by comment, and fails for any comment not in it. */
function client(model: string, answers: Record<string, Sentiment>): SentimentClient & { asked: string[] } {
  const asked: string[] = [];

  return {
    model,
    asked,
    async classify({ comment }) {
      asked.push(comment);
      if (!(comment in answers)) throw new Error(`${model} is down`);

      return answers[comment];
    },
  };
}

const SCHEDULE = { kind: "schedule" } as const;
const NOW = new Date("2026-10-21T03:00:00Z");

function setup() {
  const events: AuditEvent[] = [];

  return { events, audit: async (event: AuditEvent) => void events.push(event) };
}

describe("runAnalysis", () => {
  it("labels each unlabelled Feedback with Grok and records the model and time", async () => {
    const happy = await feedback("Loved it");
    const unhappy = await feedback("Too sweet", 2);
    const { audit } = setup();

    const result = await runAnalysis({
      sql: db.sql,
      grok: client("grok-4", { "Loved it": "positive", "Too sweet": "negative" }),
      gemini: client("gemini-2.5", {}),
      actor: SCHEDULE,
      audit,
      now: NOW,
    });

    expect(result).toEqual({ status: "done", analyzed: 2, failed: 0, model: "grok-4" });
    expect(await stored(happy)).toMatchObject({ sentiment: "positive", sentiment_model: "grok-4", sentiment_analyzed_at: NOW });
    expect(await stored(unhappy)).toMatchObject({ sentiment: "negative", sentiment_model: "grok-4" });
  });

  it("uses Gemini for a Feedback Grok fails on, and records Gemini as its model", async () => {
    const id = await feedback("Okay I guess");
    const { audit } = setup();

    const result = await runAnalysis({
      sql: db.sql,
      grok: client("grok-4", {}),
      gemini: client("gemini-2.5", { "Okay I guess": "neutral" }),
      actor: SCHEDULE,
      audit,
      now: NOW,
    });

    expect(result).toMatchObject({ status: "done", analyzed: 1, failed: 0, model: "gemini-2.5" });
    expect(await stored(id)).toMatchObject({ sentiment: "neutral", sentiment_model: "gemini-2.5" });
  });

  it("leaves a Feedback unlabelled when both fail, counts it, and retries it on the next run", async () => {
    const id = await feedback("Hmm");
    const { audit } = setup();

    const first = await runAnalysis({
      sql: db.sql,
      grok: client("grok-4", {}),
      gemini: client("gemini-2.5", {}),
      actor: SCHEDULE,
      audit,
      now: NOW,
    });

    expect(first).toMatchObject({ status: "done", analyzed: 0, failed: 1 });
    expect((await stored(id)).sentiment).toBeNull();

    const second = await runAnalysis({
      sql: db.sql,
      grok: client("grok-4", { Hmm: "neutral" }),
      gemini: client("gemini-2.5", {}),
      actor: SCHEDULE,
      audit,
      now: NOW,
    });

    expect(second).toMatchObject({ analyzed: 1, failed: 0 });
    expect((await stored(id)).sentiment).toBe("neutral");
  });

  it("never asks about Feedback that is already labelled", async () => {
    const id = await feedback("Old news", 5, "positive");
    await feedback("Fresh");
    const grok = client("grok-4", { Fresh: "neutral" });

    await runAnalysis({ sql: db.sql, grok, gemini: null, actor: SCHEDULE, audit: setup().audit, now: NOW });

    expect(grok.asked).toEqual(["Fresh"]);
    expect(await stored(id)).toMatchObject({ sentiment: "positive", sentiment_model: "earlier-model" });
  });

  it("works with only Grok or only Gemini configured", async () => {
    await feedback("Fine");

    const result = await runAnalysis({
      sql: db.sql,
      grok: null,
      gemini: client("gemini-2.5", { Fine: "neutral" }),
      actor: SCHEDULE,
      audit: setup().audit,
      now: NOW,
    });

    expect(result).toMatchObject({ analyzed: 1, model: "gemini-2.5" });
  });

  it("reports missing keys as their own state and touches nothing", async () => {
    const id = await feedback("Fine");
    const { audit, events } = setup();

    const result = await runAnalysis({ sql: db.sql, grok: null, gemini: null, actor: SCHEDULE, audit, now: NOW });

    expect(result).toEqual({ status: "no-keys" });
    expect((await stored(id)).sentiment).toBeNull();
    expect(await db.sql`select 1 from feedback_analysis_runs`).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it("does nothing, and records nothing, when every Feedback is already labelled", async () => {
    await feedback("Done", 5, "positive");
    const { audit, events } = setup();

    const result = await runAnalysis({
      sql: db.sql,
      grok: client("grok-4", {}),
      gemini: null,
      actor: SCHEDULE,
      audit,
      now: NOW,
    });

    expect(result).toEqual({ status: "nothing-to-do" });
    expect(await db.sql`select 1 from feedback_analysis_runs`).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it("records the run with who started it, the counts and the model", async () => {
    await feedback("Loved it");
    await feedback("Hmm");

    await runAnalysis({
      sql: db.sql,
      grok: client("grok-4", { "Loved it": "positive" }),
      gemini: client("gemini-2.5", {}),
      actor: { kind: "staff", id: "s1", name: "Ana Staff" },
      audit: setup().audit,
      now: NOW,
    });

    const [run] = await db.sql`select * from feedback_analysis_runs`;

    expect(run).toMatchObject({
      started_by_kind: "staff",
      started_by_id: "s1",
      started_by_name: "Ana Staff",
      analyzed: 1,
      failed: 1,
      model: "grok-4",
    });
    expect(run.finished_at).not.toBeNull();
  });

  it("closes the run record even when the run is cut short", async () => {
    await feedback("Loved it");
    await feedback("Fine");
    // A database failure mid-run: the run must still be closed with what it did.
    let calls = 0;
    const breaking = {
      model: "grok-4",
      async classify(): Promise<Sentiment> {
        calls += 1;
        if (calls === 2) await db.sql`alter table order_feedback add constraint stop check (sentiment <> 'positive' or false) not valid`;
        return "positive";
      },
    };

    await expect(
      runAnalysis({ sql: db.sql, grok: breaking, gemini: null, actor: SCHEDULE, audit: setup().audit, now: NOW }),
    ).rejects.toThrow();

    const [run] = await db.sql`select * from feedback_analysis_runs`;
    expect(run.finished_at).not.toBeNull();

    await db.sql`alter table order_feedback drop constraint stop`;
  });

  it("writes a feedback.analysis_run audit event for CRMS, the Feedback Module and the Actor", async () => {
    await feedback("Loved it");
    const { audit, events } = setup();

    await runAnalysis({
      sql: db.sql,
      grok: client("grok-4", { "Loved it": "positive" }),
      gemini: null,
      actor: SCHEDULE,
      audit,
      now: NOW,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "CRMS",
      module: "Feedback",
      action: "feedback.analysis_run",
      outcome: "success",
      actor: { type: "process" },
      metadata: { analyzed: 1, failed: 0, model: "grok-4" },
    });
  });

  it("names the Staff member as Actor when Staff started the run", async () => {
    await feedback("Loved it");
    const { audit, events } = setup();

    await runAnalysis({
      sql: db.sql,
      grok: client("grok-4", { "Loved it": "positive" }),
      gemini: null,
      actor: { kind: "staff", id: "s1", name: "Ana Staff" },
      audit,
      now: NOW,
    });

    expect(events[0].actor).toEqual({ type: "staff", id: "s1", display_name: "Ana Staff" });
  });

  it("still finishes and reports the run when writing the audit event fails", async () => {
    await feedback("Loved it");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runAnalysis({
      sql: db.sql,
      grok: client("grok-4", { "Loved it": "positive" }),
      gemini: null,
      actor: SCHEDULE,
      audit: async () => {
        throw new Error("audit-logs is down");
      },
      now: NOW,
    });

    expect(result).toMatchObject({ status: "done", analyzed: 1 });
  });
});
