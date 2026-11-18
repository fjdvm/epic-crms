-- Additive migration (#595). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- One Proof reader result per saved payment proof. The primary key is the "one result per proof" rule:
-- a retry cannot make a second record, and a replacement proof (a new proof id) gets its own row.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.payment_proof_reads (
  proof_id integer PRIMARY KEY,
  order_id integer NOT NULL,
  status text NOT NULL CHECK (status IN ('reading', 'read', 'needs-review')),
  findings jsonb,
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_fingerprint text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS payment_proof_reads_order_idx ON crms.payment_proof_reads (order_id);
COMMIT;
