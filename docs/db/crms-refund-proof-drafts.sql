-- Additive migration (#615). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- A refund proof and its details are SAVED first, so the Proof reader's findings can be seen before Staff mark the Return Refunded.
-- One row per Return: saving a replacement proof replaces the row (and gets its own read). Corrections only ever ADD rows; the original reading stays in crms.refund_proof_reads.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.refund_proof_drafts (
  return_id integer PRIMARY KEY,
  proof_file_id text NOT NULL,
  amount_in_centavos integer NOT NULL,
  expected_in_centavos integer NOT NULL,
  method text NOT NULL,
  refunded_on text NOT NULL,
  reference text NOT NULL,
  delivery_fee_reason text,
  saved_by_id text NOT NULL,
  saved_by_name text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crms.refund_proof_corrections (
  id bigserial PRIMARY KEY,
  return_id integer NOT NULL,
  proof_file_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('correction', 'override')),
  field text NOT NULL,
  original_value text,
  corrected_value text,
  original_finding text NOT NULL,
  reason text NOT NULL,
  by_id text NOT NULL,
  by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refund_proof_corrections_file_idx ON crms.refund_proof_corrections (proof_file_id);
COMMIT;
