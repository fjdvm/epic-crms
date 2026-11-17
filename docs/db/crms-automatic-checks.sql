-- Additive migration (#528). Run as creoms_writer (owner of crms); no storefront writes.
-- Automatic checks: one on/off switch and the numbers for each flag-only rule. No row means the
-- defaults in code (today's behaviour). The first-order amount stays in crms.cod_settings (#351).
BEGIN;
CREATE TABLE IF NOT EXISTS crms.automatic_checks (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_by_id text, changed_by_name text, changed_at timestamptz
);
INSERT INTO crms.automatic_checks (singleton) VALUES (true) ON CONFLICT DO NOTHING;
COMMIT;
