-- #495. Run as creoms_writer. The immutable record is also the local Audit Event.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.assistant_answer_flags (
  message_id integer PRIMARY KEY,
  ticket_id integer NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  staff_id text NOT NULL,
  staff_name text NOT NULL,
  answer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
