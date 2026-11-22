-- Additive migration (#614). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- One Proof reader result per saved refund proof. The primary key (the proof's stored file) is the "one result per proof" rule:
-- a retry cannot make a second record.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.refund_proof_reads (
  proof_file_id text PRIMARY KEY,
  return_id integer NOT NULL,
  status text NOT NULL CHECK (status IN ('reading', 'read', 'needs-review')),
  findings jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS refund_proof_reads_return_idx ON crms.refund_proof_reads (return_id);
COMMIT;
