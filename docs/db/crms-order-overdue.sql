-- Apply as creoms_writer before deploying #574. Safe to re-run. Writes only to CREOMS's crms schema.
-- Adds the Manager alert for an Order left unconfirmed past the Admin's limit (kind order-overdue).
-- The limit itself is in crms.automatic_checks (JSON, default 48 hours); no new table.
BEGIN;
ALTER TABLE crms.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE crms.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed', 'ticket-reassigned', 'ticket-escalated', 'ticket-sent-back',
                  'feedback-low', 'order-delivery-fee', 'order-placed', 'order-free-delivery', 'order-payment-proof', 'order-overdue', 'return-requested'));
COMMIT;
