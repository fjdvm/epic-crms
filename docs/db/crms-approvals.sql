-- Additive migration. Run as creoms_writer (owner of crms); no storefront writes.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.approval_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  limit_in_centavos bigint NOT NULL DEFAULT 500000 CHECK (limit_in_centavos >= 0 AND limit_in_centavos <= 9007199254740991),
  changed_by_id text, changed_by_name text, changed_at timestamptz
);
INSERT INTO crms.approval_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS crms.approval_requests (
  id uuid PRIMARY KEY,
  module text NOT NULL,
  action text NOT NULL,
  target_id text NOT NULL,
  payload jsonb NOT NULL,
  amount_in_centavos bigint NOT NULL CHECK (amount_in_centavos >= 0),
  limit_in_centavos bigint NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  requester_id text NOT NULL, requester_name text NOT NULL,
  status text NOT NULL DEFAULT 'waiting-manager' CHECK (status IN ('waiting-manager','waiting-ceo','approved','declined','executing','completed')),
  manager_id text, manager_name text, manager_at timestamptz,
  ceo_id text, ceo_name text, ceo_at timestamptz,
  decline_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS approval_waiting ON crms.approval_requests (status, requested_at);
-- A durable local record also survives a shared audit service outage.
CREATE TABLE IF NOT EXISTS crms.approval_events (
  id uuid PRIMARY KEY, request_id uuid REFERENCES crms.approval_requests(id),
  action text NOT NULL, actor_id text NOT NULL, actor_name text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crms.approval_notices (
  key text PRIMARY KEY, request_id uuid NOT NULL REFERENCES crms.approval_requests(id),
  audience text NOT NULL CHECK (audience IN ('manager','ceo','requester')),
  text text NOT NULL, delivered_at timestamptz
);
COMMIT;
