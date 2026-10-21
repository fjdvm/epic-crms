import type postgres from "postgres";

export type Sentiment = "positive" | "neutral" | "negative";

export const SENTIMENTS: readonly Sentiment[] = ["positive", "neutral", "negative"];

/** One model that can label a Feedback. Throws when it cannot, so the next model can be tried. */
export interface SentimentClient {
  /** What is saved on the Feedback as the model that produced its label. */
  model: string;
  classify(feedback: { comment: string; rating: number }): Promise<Sentiment>;
}

/** Who started a run: the schedule, or a Staff member pressing Analyze. */
export type AnalysisActor = { kind: "schedule" } | { kind: "staff"; id: string; name: string };

/** An Audit Event as audit-logs accepts it; only the fields CREOMS writes. */
export interface AuditEvent {
  source: "CRMS";
  module: "Feedback";
  action: "feedback.analysis_run";
  outcome: "success" | "failure";
  actor: { type: string; id: string; display_name: string };
  target: { type: string; id: string; display_name: string };
  description: string;
  occurred_at: string;
  metadata: { analyzed: number; failed: number; model: string | null };
}

export type WriteAuditEvent = (event: AuditEvent) => Promise<void>;

export type AnalysisResult =
  | { status: "no-keys" }
  /** Another run has started and not finished. */
  | { status: "busy" }
  /** Analyze was pressed within 5 minutes of the last run's end. */
  | { status: "cooling-down"; until: Date }
  | { status: "nothing-to-do" }
  | { status: "done"; analyzed: number; failed: number; model: string | null };

/** How long after a run ends before Analyze can start another. */
export const COOLDOWN_MS = 5 * 60_000;

/**
 * A run with no end older than this died without closing its record (the route's limit is 5 minutes),
 * so it no longer counts as in progress.
 */
export const STALE_RUN_MS = 15 * 60_000;

/** What the Analyze button needs to know about the runs so far. */
export interface AnalysisStatus {
  /** A run has started and not finished. */
  running: boolean;
  /** When Analyze can be pressed again, while within 5 minutes of the last run's end; otherwise null. */
  availableAt: Date | null;
  /** How many Feedbacks the last finished run could not analyze. */
  lastFailed: number;
}

/** The state of the runs at `now`, read from the run record. */
export async function analysisStatus(sql: postgres.Sql | postgres.TransactionSql, now = new Date()): Promise<AnalysisStatus> {
  const [running] = await sql<{ id: number }[]>`
    select id from feedback_analysis_runs
    where finished_at is null and started_at > ${new Date(now.getTime() - STALE_RUN_MS)}
    limit 1`;
  const [last] = await sql<{ finished_at: Date; failed: number }[]>`
    select finished_at, failed from feedback_analysis_runs
    where finished_at is not null
    order by finished_at desc, id desc
    limit 1`;

  const availableAt = last ? new Date(last.finished_at.getTime() + COOLDOWN_MS) : null;

  return {
    running: running !== undefined,
    availableAt: availableAt && availableAt > now ? availableAt : null,
    lastFailed: last?.failed ?? 0,
  };
}

export interface AnalysisOptions {
  /** The connection that may write only the Sentiment columns and the run record. */
  sql: postgres.Sql;
  /** Null when its key is not set. */
  groq: SentimentClient | null;
  /** Null when its key is not set. */
  gemini: SentimentClient | null;
  actor: AnalysisActor;
  audit: WriteAuditEvent;
  /** Refuse to start within 5 minutes of the last run's end: true for Analyze, not for the schedule's own slot. */
  cooldown?: boolean;
  now?: Date;
}

/** Groq first, then Gemini. Null when both fail, or when neither is configured. */
async function label(
  models: SentimentClient[],
  feedback: { comment: string; rating: number },
): Promise<{ sentiment: Sentiment; model: string } | null> {
  for (const client of models) {
    try {
      return { sentiment: await client.classify(feedback), model: client.model };
    } catch (error) {
      console.error(`${client.model} could not label a Feedback`, error);
    }
  }

  return null;
}

/**
 * One analysis run: labels every Feedback that has no Sentiment, Groq first and Gemini when Groq
 * fails, and records the run and its audit event. A Feedback both models fail on stays unlabelled
 * and is picked up again by the next run. Labelled Feedback is never asked about again. It refuses to
 * start while another run is in progress, and, with `cooldown`, within 5 minutes of the last run's end.
 */
export async function runAnalysis({
  sql,
  groq,
  gemini,
  actor,
  audit,
  cooldown = false,
  now = new Date(),
}: AnalysisOptions): Promise<AnalysisResult> {
  const models = [groq, gemini].filter((client): client is SentimentClient => client !== null);

  if (models.length === 0) return { status: "no-keys" };

  const actorId = actor.kind === "staff" ? actor.id : null;
  const actorName = actor.kind === "staff" ? actor.name : null;

  type Pending = { order_id: number; rating: number; comment: string };

  // Checking the locks and recording the run happen under one table lock, so two presses of Analyze
  // at the same moment cannot both start a run.
  const claim = await sql.begin(async (tx): Promise<AnalysisResult | { runId: number; pending: Pending[] }> => {
    await tx`lock table feedback_analysis_runs in share row exclusive mode`;

    const status = await analysisStatus(tx, now);

    if (status.running) return { status: "busy" };
    if (cooldown && status.availableAt) return { status: "cooling-down", until: status.availableAt };

    const pending = await tx<Pending[]>`
      select order_id, rating, comment from order_feedback
      where sentiment is null
      order by created_at, order_id`;

    if (pending.length === 0) return { status: "nothing-to-do" };

    const [{ id }] = await tx<{ id: number }[]>`
      insert into feedback_analysis_runs (started_by_kind, started_by_id, started_by_name, started_at)
      values (${actor.kind}, ${actorId}, ${actorName}, ${now})
      returning id`;

    return { runId: id, pending: [...pending] };
  });

  if ("status" in claim) return claim;

  const { runId, pending } = claim;

  const used: string[] = [];
  let analyzed = 0;
  let failed = 0;

  try {
    for (const feedback of pending) {
      const result = await label(models, { comment: feedback.comment, rating: feedback.rating });

      if (!result) {
        failed += 1;
        continue;
      }

      await sql`
        update order_feedback
        set sentiment = ${result.sentiment}, sentiment_model = ${result.model}, sentiment_analyzed_at = ${now}
        where order_id = ${feedback.order_id} and sentiment is null`;

      analyzed += 1;
      if (!used.includes(result.model)) used.push(result.model);
    }
  } finally {
    // Even when the run is cut short, close it, so it never looks in progress and counts what it did.
    await sql`
      update feedback_analysis_runs
      set finished_at = ${new Date()}, analyzed = ${analyzed}, failed = ${failed},
        model = ${used.length > 0 ? used.join(", ") : null}
      where id = ${runId}`;
  }

  const model = used.length > 0 ? used.join(", ") : null;

  try {
    await audit({
      source: "CRMS",
      module: "Feedback",
      action: "feedback.analysis_run",
      outcome: failed === 0 ? "success" : "failure",
      actor:
        actor.kind === "staff"
          ? { type: "staff", id: actor.id, display_name: actor.name }
          : { type: "process", id: "feedback-analysis", display_name: "Scheduled Feedback analysis" },
      target: { type: "feedback-analysis-run", id: String(runId), display_name: `Feedback analysis run ${runId}` },
      description: `Feedback analysis labelled ${analyzed} Feedback${failed > 0 ? ` and could not analyze ${failed}` : ""}.`,
      occurred_at: now.toISOString(),
      metadata: { analyzed, failed, model },
    });
  } catch (error) {
    // A failure to write the audit event never fails the run.
    console.error("The Feedback analysis audit event could not be written", error);
  }

  return { status: "done", analyzed, failed, model };
}
