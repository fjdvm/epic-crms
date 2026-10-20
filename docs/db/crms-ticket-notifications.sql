-- Upgrades an existing crms schema (docs/db/crms-schema.sql as first run) for Ticket notifications.
-- NOT YET RUN: needs the owner's approval. Run as creoms_writer, which owns crms.

ALTER TABLE crms.notifications
  ADD COLUMN kind text NOT NULL DEFAULT 'new-customer'
    CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed')),
  ADD COLUMN ticket_id integer,
  ADD COLUMN recipient_id text;

-- Several Ticket alerts can name the same Customer; only New Customer alerts stay one per Customer.
ALTER TABLE crms.notifications DROP CONSTRAINT notifications_customer_id_key;
CREATE UNIQUE INDEX notifications_new_customer ON crms.notifications (customer_id) WHERE kind = 'new-customer';

CREATE TABLE crms.seen_ticket_events (
  event_key text PRIMARY KEY,
  seen_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crms.ticket_sync_state (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  baselined_at timestamptz NOT NULL DEFAULT now()
);
