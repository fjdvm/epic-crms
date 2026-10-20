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

-- Bell notifications. kind says what happened: a New Customer (at most one per Customer) or a
-- Ticket event. recipient_id is the Claimer's Portal id; NULL means every Staff member who may see
-- that kind (Customer Profiles for new-customer, Tickets for the rest). read_at is shared.
CREATE TABLE crms.notifications (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind          text NOT NULL DEFAULT 'new-customer'
                CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed')),
  customer_id   text NOT NULL,
  customer_name text NOT NULL,
  ticket_id     integer,
  recipient_id  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz
);

CREATE UNIQUE INDEX notifications_new_customer ON crms.notifications (customer_id) WHERE kind = 'new-customer';

CREATE INDEX notifications_unread ON crms.notifications (created_at DESC) WHERE read_at IS NULL;

-- Walk-in Customers: people Staff add by hand, with no storefront account. Never written to the
-- storefront. mobile is stored normalised (11 digits, 09XXXXXXXXX); email is stored lower-case.
CREATE TABLE crms.walk_in_customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name        text NOT NULL,
  last_name         text NOT NULL,
  mobile            text NOT NULL CHECK (mobile ~ '^09[0-9]{9}$'),
  email             text CHECK (email = lower(email)),
  birthday          date,
  preferred_contact text,
  source            text,
  tags              text[] NOT NULL DEFAULT '{}',
  email_consent     boolean NOT NULL DEFAULT false,
  sms_consent       boolean NOT NULL DEFAULT false,
  notes             text,
  address_street    text,
  address_province  text,
  address_city      text,
  address_barangay  text,
  address_zip       text,
  address_landmark  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- One profile per person: the backstop for the duplicate check under concurrent saves.
CREATE UNIQUE INDEX walk_in_customers_mobile ON crms.walk_in_customers (mobile);
CREATE UNIQUE INDEX walk_in_customers_email ON crms.walk_in_customers (email) WHERE email IS NOT NULL;

-- Ticket events CREOMS has already seen, one row per event (ticket-new:<id>, ticket-message:<id>,
-- ticket-not-fixed:<id>:<resolved_at>). The first sync fills this with every event already in
-- the window, so the bell starts empty; the unique key makes an alert appear once per event.
CREATE TABLE crms.seen_ticket_events (
  event_key text PRIMARY KEY,
  seen_at   timestamptz NOT NULL DEFAULT now()
);

-- One row, set by the first Ticket sync.
CREATE TABLE crms.ticket_sync_state (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  baselined_at timestamptz NOT NULL DEFAULT now()
);
