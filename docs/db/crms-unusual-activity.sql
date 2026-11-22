-- #474. Run as creoms_writer before deployment. Additive and safe to rerun.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.unusual_activity_dismissals (
  staff_id text NOT NULL,
  alert_key text NOT NULL,
  numbers jsonb NOT NULL CHECK (jsonb_typeof(numbers) = 'object'),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, alert_key)
);
COMMIT;
