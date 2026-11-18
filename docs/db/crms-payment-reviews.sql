-- Additive migration (#593). Run as creoms_writer (owner of crms); no storefront writes. Safe to re-run.
-- Who has claimed a Manager payment review (an Order with 3 rejected proofs), and the two new Manager alerts.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.payment_review_claims (
  order_id integer PRIMARY KEY,
  claimed_by_id text NOT NULL,
  claimed_by_name text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crms.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE crms.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed', 'ticket-reassigned', 'ticket-escalated', 'ticket-sent-back',
                  'feedback-low', 'order-delivery-fee', 'order-placed', 'order-free-delivery', 'order-payment-proof', 'order-overdue',
                  'payment-review', 'payment-review-overdue', 'return-requested'));
COMMIT;
