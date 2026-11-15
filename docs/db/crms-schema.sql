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

-- Run as the database owner on a managed Postgres: the creating role can administer creoms_writer
-- but not act as it unless granted. The grant is dropped again at the end of this file.
GRANT creoms_writer TO CURRENT_USER WITH SET TRUE;

CREATE SCHEMA crms AUTHORIZATION creoms_writer;

-- Everything below is created as creoms_writer, so it owns every table in crms.
SET ROLE creoms_writer;

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
-- Ticket event, Order event, Return request or low-rating Feedback. recipient_id is the Claimer's Portal id; NULL means every
-- Staff member who may see that kind (Customer Profiles for new-customer, Tickets for the Ticket
-- kinds, Feedback for feedback-low, Orders for order-delivery-fee and order-placed, Payments for order-payment-proof, Returns for return-requested).
-- read_at is shared.
CREATE TABLE crms.notifications (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind          text NOT NULL DEFAULT 'new-customer'
                CHECK (kind IN ('new-customer', 'ticket-new', 'ticket-message', 'ticket-not-fixed', 'feedback-low', 'order-delivery-fee', 'order-placed', 'order-free-delivery', 'order-payment-proof', 'return-requested')),
  customer_id   text NOT NULL,
  customer_name text NOT NULL,
  ticket_id     integer,
  order_id      integer,
  rating        smallint,
  return_id     integer,
  recipient_id  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz
);

CREATE UNIQUE INDEX notifications_new_customer ON crms.notifications (customer_id) WHERE kind = 'new-customer';

CREATE INDEX notifications_unread ON crms.notifications (created_at DESC) WHERE read_at IS NULL;

-- Run as creoms_writer on the target database. No storefront tables are changed.
CREATE TABLE IF NOT EXISTS crms.customer_notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id text NOT NULL,
  author_id text NOT NULL,
  author_name text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND body ~ '[^[:space:]]'),
  operation_id text NOT NULL CHECK (char_length(operation_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (author_id, operation_id)
);
CREATE INDEX IF NOT EXISTS customer_notes_customer_created ON crms.customer_notes (customer_id, created_at DESC, id DESC);

-- Permanence trigger: installed by docs/db/crms-customer-notes.sql.

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

-- Orders whose Feedback CREOMS has already seen, so each low-rating Feedback alerts once. The first
-- Feedback sync fills this with everything in the window, so the bell starts empty.
CREATE TABLE crms.seen_feedback (
  order_id integer PRIMARY KEY,
  seen_at  timestamptz NOT NULL DEFAULT now()
);

-- One row, set by the first Feedback sync.
CREATE TABLE crms.feedback_sync_state (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  baselined_at timestamptz NOT NULL DEFAULT now()
);

-- Stable placement and Payment proof keys; the first sync baselines existing events.
CREATE TABLE crms.seen_order_events (
  event_key text PRIMARY KEY,
  seen_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crms.order_sync_state (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  baselined_at timestamptz NOT NULL DEFAULT now(),
  all_orders_baselined boolean NOT NULL DEFAULT false
);

CREATE TABLE crms.notification_signal_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  requested bigint NOT NULL DEFAULT 0,
  processed bigint NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT '-infinity',
  lease_id uuid,
  lease_until timestamptz
);

-- Each Return request alerts once, regardless of later Return progress.
CREATE TABLE crms.seen_returns (
  return_id integer PRIMARY KEY,
  seen_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crms.return_sync_state (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  baselined_at timestamptz NOT NULL DEFAULT now()
);

-- Run as creoms_writer before deploying #249. Additive and safe to re-run.
create table if not exists crms.portal_copy_audiences (
  notification_id bigint primary key references crms.notifications(id) on delete cascade
);
create table if not exists crms.portal_copies (
  notification_id bigint not null references crms.notifications(id) on delete cascade,
  user_id text not null,
  remote_id text,
  read_synced boolean not null default false,
  last_attempt_at timestamptz,
  primary key (notification_id, user_id)
);

create index if not exists portal_copies_pending_idx on crms.portal_copies (last_attempt_at) where not read_synced;

-- #261: run as creoms_writer before deploying. Additive and safe to re-run.
-- Attribution only: neither table grants access or replaces live Portal validation.
create table if not exists crms.access_audit_sessions (
  handle_hash text primary key,
  staff_id text not null,
  staff_name text not null,
  expires_at timestamptz not null
);
create index if not exists access_audit_sessions_expiry on crms.access_audit_sessions (expires_at);

-- One row per Staff member and Module, shared across sessions and app instances.
create table if not exists crms.access_audit_refusals (
  staff_id text not null,
  module text not null,
  recorded_at timestamptz not null,
  primary key (staff_id, module)
);

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

RESET ROLE;
REVOKE creoms_writer FROM CURRENT_USER;
