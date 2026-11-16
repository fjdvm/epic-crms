-- #489. Run as creoms_writer before deployment. Additive and safe to rerun.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.return_flag_explanations (
  return_id integer NOT NULL,
  rule text NOT NULL CHECK (rule IN ('frequent-returns', 'similar-photo')),
  explanation text NOT NULL,
  model text NOT NULL,
  sent_text text NOT NULL,
  system_prompt text NOT NULL,
  asked_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (return_id, rule)
);
COMMIT;
