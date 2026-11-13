-- Apply as creoms_writer before deploying #244. Writes only to CREOMS's crms schema.
-- Safe to re-run. The first widened sync baselines historical non-actionable Orders.
BEGIN;
ALTER TABLE crms.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE crms.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed', 'feedback-low',
                 'order-delivery-fee', 'order-placed', 'order-payment-proof', 'return-requested'));
ALTER TABLE crms.order_sync_state ADD COLUMN IF NOT EXISTS all_orders_baselined boolean NOT NULL DEFAULT false;
-- Preserve the placement events already alerted under the legacy Delivery fee key.
INSERT INTO crms.seen_order_events (event_key, seen_at)
  SELECT replace(event_key, 'order-delivery-fee:', 'order-placed:'), seen_at
  FROM crms.seen_order_events WHERE event_key LIKE 'order-delivery-fee:%'
  ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS crms.notification_signal_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  requested bigint NOT NULL DEFAULT 0,
  processed bigint NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT '-infinity',
  lease_id uuid,
  lease_until timestamptz
);
COMMIT;
