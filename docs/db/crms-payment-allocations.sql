-- Additive migration (#591). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- Which Order a reused payment reference pays. The reference is the primary key, so one transfer can never fund two Orders.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.payment_reference_allocations (
  reference_normalised text PRIMARY KEY CHECK (length(reference_normalised) > 0),
  order_id bigint NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  allocated_by_id text NOT NULL,
  allocated_by_name text NOT NULL,
  allocated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
