-- #484. Run as creoms_writer before deployment. Additive and safe to rerun.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.unusual_activity_explanations (
  alert_key text PRIMARY KEY,
  numbers jsonb NOT NULL CHECK (jsonb_typeof(numbers) = 'object'),
  why text,
  what_to_do text,
  model text NOT NULL,
  sent_text text NOT NULL,
  system_prompt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (why IS NOT NULL OR what_to_do IS NOT NULL)
);
COMMIT;
