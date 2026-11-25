-- #743. Run as creoms_writer (owner of crms) on the target database before deploying.
-- Additive, safe to rerun. No storefront foreign keys or writes.
-- A pending audit record is saved with a money or Manager-approval action, delivered to the Portal afterwards and
-- retried until the gateway accepts it. `key` is the gateway's own idempotency key (a hash of the action, Target and
-- operation identity), so a replayed action saves one record and a retry never adds a second Audit Event.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.pending_audit_records (
  key text PRIMARY KEY,
  event jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'delivered')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS pending_audit_waiting ON crms.pending_audit_records (created_at) WHERE state = 'pending';
COMMIT;
