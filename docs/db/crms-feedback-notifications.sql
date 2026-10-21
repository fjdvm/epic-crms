-- Upgrades an existing crms schema (docs/db/crms-schema.sql plus crms-ticket-notifications.sql) for
-- low-rating Feedback notifications.
-- NOT YET RUN: needs the owner's approval. Run as creoms_writer, which owns crms.

ALTER TABLE crms.notifications
  DROP CONSTRAINT notifications_kind_check,
  ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed', 'feedback-low')),
  ADD COLUMN order_id integer,
  ADD COLUMN rating smallint;

CREATE TABLE crms.seen_feedback (
  order_id integer PRIMARY KEY,
  seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crms.feedback_sync_state (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  baselined_at timestamptz NOT NULL DEFAULT now()
);
