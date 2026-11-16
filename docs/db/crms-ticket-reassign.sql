-- #384 Manager reassign. Run as creoms_writer (owner of crms) before deploying. Additive and safe to re-run.
-- No storefront (ecommerce) change: the Claimer stays on tickets.claimed_by_id / claimed_by_name, which
-- the creoms_tickets role already updates. Every move is recorded here, so the Ticket's activity and the
-- reassign history are read from CREOMS's own schema.
BEGIN;

CREATE TABLE IF NOT EXISTS crms.ticket_reassignments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id integer NOT NULL,
  from_id text NOT NULL,
  from_name text NOT NULL,
  to_id text NOT NULL,
  to_name text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  moved_by_id text NOT NULL,
  moved_by_name text NOT NULL,
  -- Shared by every Ticket of one "move all" so a retry replays instead of moving twice.
  operation_id text NOT NULL,
  bulk boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, ticket_id)
);
CREATE INDEX IF NOT EXISTS ticket_reassignments_ticket ON crms.ticket_reassignments (ticket_id, created_at DESC);

-- The alert to the previous and the new Claimer carries who, to whom and the reason.
ALTER TABLE crms.notifications ADD COLUMN IF NOT EXISTS detail jsonb;
ALTER TABLE crms.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE crms.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed', 'ticket-reassigned', 'feedback-low',
                  'order-delivery-fee', 'order-placed', 'order-free-delivery', 'order-payment-proof', 'return-requested'));

COMMIT;
