-- Additive migration (Senior/PWD ID reader). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- One ID reader result per Senior/PWD verification. The primary key is the "one result per check" rule: a retry cannot
-- make a second record, and an ID sent again (a new verification) gets its own row. No ID number, hash or photo is stored.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.senior_pwd_id_reads (
  verification_id integer PRIMARY KEY,
  customer_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('reading', 'read', 'needs-review')),
  findings jsonb,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_fingerprint text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS senior_pwd_id_reads_customer_idx ON crms.senior_pwd_id_reads (customer_id);
COMMIT;
