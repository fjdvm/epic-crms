-- #385 Escalate. Run as creoms_writer (owner of crms) before deploying. Additive and safe to re-run.
-- No storefront (ecommerce) change: the Claimer stays on tickets.claimed_by_id, and "Escalated" is
-- derived from an open row here (one with no resolved_at).
BEGIN;

CREATE TABLE IF NOT EXISTS crms.ticket_escalations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id integer NOT NULL,
  reason text NOT NULL CHECK (reason IN ('service_level', 'money', 'food_safety', 'customer_upset')),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 500),
  escalated_by_id text NOT NULL,
  escalated_by_name text NOT NULL,
  operation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A Manager closes it by taking the Ticket or sending it back with a note.
  resolution text CHECK (resolution IN ('taken', 'sent_back')),
  resolution_note text,
  resolved_by_id text,
  resolved_by_name text,
  resolved_at timestamptz,
  CHECK ((resolution IS NULL) = (resolved_at IS NULL)),
  UNIQUE (escalated_by_id, operation_id)
);
-- A Ticket has at most one open escalation.
CREATE UNIQUE INDEX IF NOT EXISTS ticket_escalations_one_open ON crms.ticket_escalations (ticket_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS ticket_escalations_ticket ON crms.ticket_escalations (ticket_id, created_at DESC);

-- Alerts: to every Manager with the Tickets Module, and back to the Claimer when sent back.
ALTER TABLE crms.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE crms.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed', 'ticket-reassigned', 'ticket-escalated', 'ticket-sent-back',
                  'feedback-low', 'order-delivery-fee', 'order-placed', 'order-free-delivery', 'order-payment-proof', 'return-requested'));

COMMIT;
