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
  | { status: "nothing-to-do" }
  | { status: "done"; analyzed: number; failed: number; model: string | null };

export interface AnalysisOptions {
  /** The connection that may write only the Sentiment columns and the run record. */
  sql: postgres.Sql;
  /** Null when its key is not set. */
  grok: SentimentClient | null;
  /** Null when its key is not set. */
  gemini: SentimentClient | null;
  actor: AnalysisActor;
  audit: WriteAuditEvent;
  now?: Date;
}

/** Grok first, then Gemini. Null when both fail, or when neither is configured. */
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
 * One analysis run: labels every Feedback that has no Sentiment, Grok first and Gemini when Grok
 * fails, and records the run and its audit event. A Feedback both models fail on stays unlabelled
 * and is picked up again by the next run. Labelled Feedback is never asked about again.
 */
export async function runAnalysis({ sql, grok, gemini, actor, audit, now = new Date() }: AnalysisOptions): Promise<AnalysisResult> {
  const models = [grok, gemini].filter((client): client is SentimentClient => client !== null);

  if (models.length === 0) return { status: "no-keys" };

  const pending = await sql<{ order_id: number; rating: number; comment: string }[]>`
    select order_id, rating, comment from order_feedback
    where sentiment is null
    order by created_at, order_id`;

  if (pending.length === 0) return { status: "nothing-to-do" };

  const actorId = actor.kind === "staff" ? actor.id : null;
  const actorName = actor.kind === "staff" ? actor.name : null;

  const [{ id: runId }] = await sql<{ id: number }[]>`
    insert into feedback_analysis_runs (started_by_kind, started_by_id, started_by_name, started_at)
    values (${actor.kind}, ${actorId}, ${actorName}, ${now})
    returning id`;

  const used: string[] = [];
  let analyzed = 0;
  let failed = 0;

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

  const model = used.length > 0 ? used.join(", ") : null;

  await sql`
    update feedback_analysis_runs
    set finished_at = ${new Date()}, analyzed = ${analyzed}, failed = ${failed}, model = ${model}
    where id = ${runId}`;

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
