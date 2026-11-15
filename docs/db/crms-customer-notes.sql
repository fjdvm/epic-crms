-- Run as creoms_writer on the target database. No storefront tables are changed.
CREATE TABLE crms.customer_notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id text NOT NULL,
  author_id text NOT NULL,
  author_name text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND body ~ '[^[:space:]]'),
  operation_id text NOT NULL CHECK (char_length(operation_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (author_id, operation_id)
);
CREATE INDEX customer_notes_customer_created ON crms.customer_notes (customer_id, created_at DESC, id DESC);

CREATE FUNCTION crms.refuse_customer_note_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Customer notes are permanent; write a new Customer note to correct one.';
END;
$$;
CREATE TRIGGER customer_notes_permanent BEFORE UPDATE OR DELETE ON crms.customer_notes
FOR EACH ROW EXECUTE FUNCTION crms.refuse_customer_note_change();
