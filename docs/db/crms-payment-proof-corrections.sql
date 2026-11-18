-- Additive migration (#597). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- Append-only: Staff or a Manager corrects what the Proof reader read, or proceeds despite a flag, with a reason.
-- The original reading stays untouched in crms.payment_proof_reads; nothing here is ever updated or deleted.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.payment_proof_corrections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proof_id integer NOT NULL,
  order_id integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('correction', 'override')),
  field text NOT NULL CHECK (field IN ('amount', 'date', 'reference', 'recipient', 'accountNumber')),
  original_value text,
  corrected_value text,
  original_finding text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  by_id text NOT NULL,
  by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'correction' OR length(btrim(corrected_value)) > 0)
);
CREATE INDEX IF NOT EXISTS payment_proof_corrections_proof_idx ON crms.payment_proof_corrections (proof_id, id);
COMMIT;
