-- AI Insights suggestions (#731). Run as creoms_writer before deployment. Additive and safe to rerun.
BEGIN;
-- What each Manager-level person did with a suggestion, with their name; it comes back only when its numbers get worse.
CREATE TABLE IF NOT EXISTS crms.ai_insight_decisions (
  staff_id text NOT NULL,
  staff_name text NOT NULL,
  suggestion_key text NOT NULL,
  numbers jsonb NOT NULL CHECK (jsonb_typeof(numbers) = 'object'),
  decision text NOT NULL CHECK (decision IN ('accepted', 'dismissed')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, suggestion_key)
);
-- One kept AI-written "why it matters" per suggestion, with exactly what was sent; made again only when the numbers change.
CREATE TABLE IF NOT EXISTS crms.ai_insight_notes (
  suggestion_key text PRIMARY KEY,
  numbers jsonb NOT NULL CHECK (jsonb_typeof(numbers) = 'object'),
  why text NOT NULL,
  model text NOT NULL,
  sent_text text NOT NULL,
  system_prompt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
