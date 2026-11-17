-- Upgrades an existing crms schema for Order placement and email outcome Audit Events (#572).
-- Run as creoms_writer, which owns crms. Changes only CREOMS tables; the storefront stays read-only.
BEGIN;

CREATE TABLE IF NOT EXISTS crms.seen_order_audit_events (
  operation_id text PRIMARY KEY,
  delivered_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
