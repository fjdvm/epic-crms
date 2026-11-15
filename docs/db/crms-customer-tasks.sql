-- #420. Run as creoms_writer on the target database before deploying.
-- Additive, safe to rerun. No storefront foreign keys or writes.
CREATE TABLE IF NOT EXISTS crms.customer_tasks (
  id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 200),
  due_date date NOT NULL,
  owner_id text NOT NULL,
  owner_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  done_at timestamptz,
  done_by_id text,
  done_by_name text,
  CHECK ((done_at IS NULL AND done_by_id IS NULL AND done_by_name IS NULL)
      OR (done_at IS NOT NULL AND done_by_id IS NOT NULL AND done_by_name IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS customer_tasks_profile ON crms.customer_tasks (customer_id, due_date, id);
CREATE INDEX IF NOT EXISTS customer_tasks_owner ON crms.customer_tasks (owner_id, due_date, id) WHERE done_at IS NULL;
-- Operation receipts survive later changes; a replay returns its original result.
-- The audit payload is committed with the change and delivered through the existing boundary.
CREATE TABLE IF NOT EXISTS crms.customer_task_operations (
  actor_id text NOT NULL,
  operation_id text NOT NULL,
  request text NOT NULL,
  result jsonb NOT NULL,
  event jsonb NOT NULL,
  audit_sent boolean NOT NULL DEFAULT false,
  PRIMARY KEY (actor_id, operation_id)
);
