-- #473. Additive; run as creoms_writer before deploying. No storefront tables or grants change.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.ticket_summaries (
  ticket_id integer PRIMARY KEY,
  last_message_id bigint NOT NULL,
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 800),
  model text NOT NULL,
  sent_text text NOT NULL,
  system_prompt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
