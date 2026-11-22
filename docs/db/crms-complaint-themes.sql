-- #481. Additive; run as creoms_writer before deploying. No storefront tables or grants change.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.complaint_themes (
  -- Philippines-time days, "YYYY-MM-DD"; an open end is the empty string.
  period_from text NOT NULL,
  period_to text NOT NULL,
  themes jsonb NOT NULL,
  tickets_read integer NOT NULL,
  returns_read integer NOT NULL,
  feedback_read integer NOT NULL,
  items_available integer NOT NULL,
  model text,
  sent_text text NOT NULL,
  system_prompt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_from, period_to)
);
COMMIT;
