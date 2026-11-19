-- Feedback Analyze drawer: the last ranked products with their AI suggestions. Additive; run as creoms_writer before deploying.
-- One row, so Admin and the CEO can open the last result without causing a model call.
BEGIN;
CREATE TABLE IF NOT EXISTS crms.feedback_product_advice (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  result jsonb NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
