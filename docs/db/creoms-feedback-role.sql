-- CREOMS's role for labelling Feedback in the shared ecommerce Neon database.
--
-- The ecommerce repo owns the schema and runs every migration; CREOMS runs none. Step 1 is what the
-- ecommerce migration must add (a hand-off, not run from here). Step 2 is the role.
-- Replace <PASSWORD> with a generated secret before running. Do not commit it.

-- 1. Ecommerce migration: Sentiment on Feedback, and the record of analysis runs.
--
-- ALTER TABLE public.order_feedback
--   ADD COLUMN sentiment text CHECK (sentiment IN ('positive', 'neutral', 'negative')),
--   ADD COLUMN sentiment_model text,
--   ADD COLUMN sentiment_analyzed_at timestamptz;
--
-- CREATE TABLE public.feedback_analysis_runs (
--   id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
--   started_by_kind text NOT NULL,          -- 'schedule' or 'staff'
--   started_by_id text,                     -- the Staff member, when 'staff'
--   started_by_name text,
--   started_at timestamptz NOT NULL DEFAULT now(),
--   finished_at timestamptz,                -- empty while the run is in progress
--   analyzed integer NOT NULL DEFAULT 0,
--   failed integer NOT NULL DEFAULT 0,
--   model text
-- );

-- 2. The role: read Feedback, write only its Sentiment columns and the run record.
CREATE ROLE creoms_feedback LOGIN PASSWORD '<PASSWORD>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

GRANT USAGE ON SCHEMA public TO creoms_feedback;

GRANT SELECT ON public.order_feedback TO creoms_feedback;
GRANT UPDATE (sentiment, sentiment_model, sentiment_analyzed_at) ON public.order_feedback TO creoms_feedback;

GRANT SELECT, INSERT, UPDATE ON public.feedback_analysis_runs TO creoms_feedback;
-- UPDATE also lets a run take `LOCK TABLE feedback_analysis_runs IN SHARE ROW EXCLUSIVE MODE`, which
-- stops two presses of Analyze from both starting a run.
-- Required for the run record's identity column.
GRANT USAGE ON SEQUENCE public.feedback_analysis_runs_id_seq TO creoms_feedback;

-- 3. The pages that show "Last analyzed" read the run record as the read-only role.
GRANT SELECT ON public.feedback_analysis_runs TO creoms_readonly;
