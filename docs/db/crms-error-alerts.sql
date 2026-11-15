-- Additive migration (#357). Run as creoms_writer (owner of crms); no storefront writes.
-- One row per kind of error: when the owner was last emailed about it, so a kind emails at most once an hour.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.error_alerts (
  kind text PRIMARY KEY,
  last_emailed_at timestamptz NOT NULL
);
COMMIT;
