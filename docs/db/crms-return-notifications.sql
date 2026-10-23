-- Run as creoms_writer before deploying Return notifications. Safe to rerun.
-- Only CREOMS-owned tables change; storefront Returns remain read-only.
BEGIN;

ALTER TABLE crms.notifications ADD COLUMN IF NOT EXISTS return_id integer;
ALTER TABLE crms.notifications
  DROP CONSTRAINT notifications_kind_check,
  ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed', 'feedback-low',
                    'order-delivery-fee', 'order-payment-proof', 'return-requested'));

CREATE TABLE IF NOT EXISTS crms.seen_returns (
  return_id integer PRIMARY KEY,
  seen_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crms.return_sync_state (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  baselined_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
