-- Apply as creoms_writer before deploying #330. Safe to re-run.
BEGIN;
ALTER TABLE crms.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE crms.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed', 'feedback-low',
                 'order-delivery-fee', 'order-placed', 'order-free-delivery', 'order-payment-proof', 'return-requested'));
COMMIT;
