-- Run as creoms_writer before deploying Senior/PWD notifications. Safe to rerun.
-- Only CREOMS-owned tables change; the storefront's verifications stay read-only.
BEGIN;

ALTER TABLE crms.notifications ADD COLUMN IF NOT EXISTS verification_id integer;
ALTER TABLE crms.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE crms.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed', 'ticket-reassigned', 'ticket-escalated', 'ticket-sent-back',
                  'feedback-low', 'order-delivery-fee', 'order-placed', 'order-free-delivery', 'order-payment-proof', 'order-overdue',
                  'payment-review', 'payment-review-overdue', 'return-requested', 'senior-pwd-waiting'));

-- Each uploaded ID alerts once, whatever happens to it later.
CREATE TABLE IF NOT EXISTS crms.seen_senior_pwd (
  verification_id integer PRIMARY KEY,
  seen_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crms.senior_pwd_sync_state (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  baselined_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
