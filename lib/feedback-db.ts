import postgres from "postgres";

let writer: postgres.Sql | undefined;

/**
 * Connection for labelling Feedback, as the `creoms_feedback` role (see docs/db/creoms-feedback-role.sql).
 * That role can read Feedback, write only its three Sentiment columns, and add to and update the run
 * record. It cannot change the Feedback itself.
 */
export function feedbackWriterDatabase(): postgres.Sql {
  const url = process.env.CREOMS_FEEDBACK_DATABASE_URL;

  if (!url) {
    throw new Error("CREOMS_FEEDBACK_DATABASE_URL is not set; see .env.example");
  }

  writer ??= postgres(url, { max: 3, idle_timeout: 20 });

  return writer;
}
