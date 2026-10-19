-- CREOMS's own schema and writer role on the shared ecommerce Neon database (production).
-- NOT YET RUN: needs the user's approval first. CREOMS owns and migrates everything in `crms`.
--
-- The writer role can write only to `crms`. It has no access to storefront `public` or
-- `neon_auth`; those stay reachable only through the read-only creoms_readonly role
-- (docs/db/creoms-readonly-role.sql).
--
-- Replace <PASSWORD> with a generated secret before running. Do not commit it.

CREATE ROLE creoms_writer LOGIN PASSWORD '<PASSWORD>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

CREATE SCHEMA crms AUTHORIZATION creoms_writer;

-- Customers CREOMS has already seen become Customers, with or without an alert. The first sync
-- fills this with everyone who is already a Customer, so the bell starts empty.
CREATE TABLE crms.seen_customers (
  customer_id text PRIMARY KEY,
  seen_at     timestamptz NOT NULL DEFAULT now()
);

-- One row, set by the first sync, so a store with no Customers yet still baselines correctly.
CREATE TABLE crms.sync_state (
  singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  baselined_at timestamptz NOT NULL DEFAULT now()
);

-- New Customer notifications: at most one per Customer. read_at is shared by all Staff.
CREATE TABLE crms.notifications (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id   text NOT NULL UNIQUE,
  customer_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz
);

CREATE INDEX notifications_unread ON crms.notifications (created_at DESC) WHERE read_at IS NULL;
