-- Additive migration (#383). Run as creoms_writer (owner of crms); no storefront writes.
-- Service levels: the first reply target and the resolve target, the same for every Priority.
-- Every change is a new row, never an update, so a Ticket takes the pair that was in force when it
-- was opened and keeps it: a change affects only Tickets opened afterwards. The same row is the
-- local audit record of who changed what (it is also sent to the shared Audit service).
BEGIN;
CREATE TABLE IF NOT EXISTS crms.service_level_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_reply_hours integer NOT NULL CHECK (first_reply_hours BETWEEN 1 AND 8760),
  resolve_hours integer NOT NULL CHECK (resolve_hours BETWEEN 1 AND 8760 AND resolve_hours >= first_reply_hours),
  effective_from timestamptz NOT NULL DEFAULT now(),
  previous_first_reply_hours integer, previous_resolve_hours integer,
  changed_by_id text, changed_by_name text
);
-- The defaults, in force since before any Ticket: 24 hours to a first reply, 3 days to resolve.
INSERT INTO crms.service_level_changes (first_reply_hours, resolve_hours, effective_from)
  SELECT 24, 72, '1970-01-01T00:00:00Z' WHERE NOT EXISTS (SELECT 1 FROM crms.service_level_changes);
-- A missed target is stamped once, when it is first seen, and never cleared.
CREATE TABLE IF NOT EXISTS crms.ticket_service_misses (
  ticket_id integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('first_reply', 'resolve')),
  missed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, kind)
);
COMMIT;
