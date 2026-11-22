-- #388 AI-suggested Category and Priority. Run as creoms_writer (owner of crms) before deploying. Additive and safe to re-run.
-- No storefront (ecommerce) change and no new role grant: the table lives in CREOMS's own schema.
BEGIN;

CREATE TABLE IF NOT EXISTS crms.ticket_ai_suggestions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id integer NOT NULL,
  requested_by_id text NOT NULL,
  requested_by_name text NOT NULL,
  operation_id text NOT NULL,
  model text NOT NULL,
  -- Exactly what was sent to the model: the Ticket text only.
  sent_text text NOT NULL,
  category text NOT NULL,
  category_reason text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  priority_reason text NOT NULL,
  -- Nothing applies without a click: each field stays NULL until Staff accept the suggestion or change it.
  category_decision text CHECK (category_decision IN ('accepted', 'changed')),
  category_applied text,
  category_decided_by_name text,
  priority_decision text CHECK (priority_decision IN ('accepted', 'changed')),
  priority_applied text,
  priority_decided_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requested_by_id, operation_id)
);
CREATE INDEX IF NOT EXISTS ticket_ai_suggestions_ticket ON crms.ticket_ai_suggestions (ticket_id, created_at DESC);

COMMIT;
