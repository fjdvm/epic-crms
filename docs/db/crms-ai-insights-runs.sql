-- AI insights morning runs, and Helpful / Not helpful per person. Run as creoms_writer before deployment. Additive and safe to rerun.
-- No existing table is changed: "Dismiss for me" keeps using crms.ai_insight_decisions (docs/db/crms-ai-insights.sql).
BEGIN;
-- One stored result per Philippine day and period (7 or 30 days), made by the 6:00 am job; a rerun that day replaces it.
CREATE TABLE IF NOT EXISTS crms.ai_insight_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_day date NOT NULL,
  period_days integer NOT NULL CHECK (period_days IN (7, 30)),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  enough_data boolean NOT NULL,
  -- Stat row and map figures, aggregated to city: no Customer is stored here.
  figures jsonb NOT NULL CHECK (jsonb_typeof(figures) = 'object'),
  -- The insight cards, with the IDs of the records behind each.
  insights jsonb NOT NULL CHECK (jsonb_typeof(insights) = 'array'),
  summary text,
  summary_confidence text CHECK (summary_confidence IN ('high', 'medium', 'low')),
  -- What was sent to the model and which model answered, kept for review. Null when no model was asked.
  model text,
  sent_text text,
  system_prompt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_day, period_days)
);
CREATE INDEX IF NOT EXISTS ai_insight_runs_latest ON crms.ai_insight_runs (period_days, run_day DESC);
-- "Was this useful?": personal, one answer per person, insight and run, with their name.
CREATE TABLE IF NOT EXISTS crms.ai_insight_feedback (
  staff_id text NOT NULL,
  staff_name text NOT NULL,
  run_id bigint NOT NULL REFERENCES crms.ai_insight_runs (id) ON DELETE CASCADE,
  insight_key text NOT NULL,
  helpful boolean NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, run_id, insight_key)
);
COMMIT;
