-- Upgrades an existing crms schema after crms-feedback-notifications.sql for Order notifications.
-- Applied to production 2026-10-22 UTC as creoms_writer after verification on a temporary Neon branch.
-- Run as creoms_writer, which owns crms, before deploying the Order notification code on other installs.
-- Changes only CREOMS tables; the storefront Orders remain read-only.
BEGIN;

ALTER TABLE crms.notifications
  DROP CONSTRAINT notifications_kind_check,
  ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed', 'feedback-low',
                    'order-delivery-fee', 'order-payment-proof'));

CREATE TABLE crms.seen_order_events (
  event_key text PRIMARY KEY,
  seen_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crms.order_sync_state (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  baselined_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
