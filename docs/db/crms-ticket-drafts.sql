-- #479. Additive and safe to re-run as creoms_writer. No storefront changes.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.ticket_drafts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id integer NOT NULL,
  requested_by_id text NOT NULL,
  requested_by_name text NOT NULL,
  language text NOT NULL CHECK (language IN ('English', 'Taglish')),
  shorter_than_id bigint REFERENCES crms.ticket_drafts(id),
  sent_text text NOT NULL,
  system_prompt text NOT NULL,
  model text,
  reply text,
  refusal text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_drafts_ticket ON crms.ticket_drafts(ticket_id, created_at DESC);
COMMIT;
