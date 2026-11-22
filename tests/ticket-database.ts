import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createServer } from "node:net";
import postgres from "postgres";

/**
 * The slice of the ecommerce schema the Tickets pages read, as the ecommerce migrations leave it
 * (drizzle 0014, 0015 and 0039). CREOMS never migrates these tables; this mirrors them for tests only.
 */
const SCHEMA = `
  create schema neon_auth;
  create table neon_auth."user" (
    id text primary key,
    "emailVerified" boolean not null default false,
    "createdAt" timestamptz not null default now()
  );
  create table customers (
    id text primary key,
    full_name text not null,
    first_name text not null default '',
    email text not null,
    marketing_opt_in boolean not null default false,
    deleted_at timestamptz
  );
  create table senior_pwd_verifications (
    id integer primary key generated always as identity,
    customer_id text not null references customers (id),
    id_type text not null,
    status text not null default 'pending',
    id_hash text not null,
    photo_file_id text,
    photo_back_file_id text,
    submitted_at timestamptz not null default now(),
    decided_at timestamptz,
    decided_by_id text,
    decided_by_name text,
    decline_reason text,
    expires_on date,
    same_id_as_verification_id integer references senior_pwd_verifications (id),
    id_number_read text check (id_number_read in ('matched', 'differs', 'unread')),
    verified_name text
  );
  create table orders (
    id integer primary key generated always as identity,
    senior_pwd_verification_id integer references senior_pwd_verifications (id),
    customer_id text not null references customers (id),
    status text not null default 'placed',
    subtotal_in_centavos integer not null default 0,
    delivery_fee_in_centavos integer,
    approved_discount_in_centavos integer,
    total_in_centavos integer,
    free_delivery boolean not null default false,
    free_delivery_threshold_in_centavos bigint,
    fulfillment_method text not null default 'delivery',
    payment_method text not null default 'cash-on-delivery',
    gcash_reference_number text,
    payment_proof_screenshot_pathname text,
    payment_proof_file_id text,
    payment_proof_submitted_at timestamptz,
    payment_proof_rejected_at timestamptz,
    payment_proof_rejections integer not null default 0,
    dispatched_at timestamptz,
    courier text,
    courier_tracking_url text,
    rider_name text,
    rider_plate text,
    rider_phone text,
    delivered_at timestamptz,
    collected_at timestamptz,
    cod_collected_amount_in_centavos integer,
    cod_collected_at timestamptz,
    cod_collected_by_id text,
    cod_collected_by_name text,
    delivery_photo_file_id text,
    delivery_photo_removed_at timestamptz,
    packed_by_id text,
    packed_by_name text,
    packed_at timestamptz,
    paid_by_id text,
    paid_by_name text,
    paid_at timestamptz,
    replacement_for_order_id integer references orders (id),
    replacement_for_return_id integer,
    refund_window_extended_at timestamptz,
    refund_window_extension_reason text,
    created_at timestamptz not null default now()
  );
  create table order_payment_proofs (
    id integer primary key generated always as identity,
    order_id integer not null references orders (id) on delete cascade,
    reference text,
    confirmed_amount_in_centavos integer,
    confirmed_paid_at timestamptz,
    confirmed_recipient text,
    expected_recipient text,
    screenshot_file_id text,
    screenshot_pathname text,
    submitted_at timestamptz not null default now(),
    rejected_at timestamptz,
    rejected_by_id text,
    rejected_by_name text,
    rejection_reason text,
    account_id text,
    account_method text,
    account_bank_name text,
    account_label text,
    account_name text,
    account_number text
  );
  create table order_email_outcomes (
    order_id integer not null references orders (id) on delete cascade,
    kind text not null,
    occurrence text,
    status text not null,
    reason text,
    updated_at timestamptz not null default now()
  );
  create unique index order_email_outcomes_event on order_email_outcomes (order_id, kind, coalesce(occurrence, ''));
  create table order_delivery_addresses (
    order_id integer primary key references orders (id) on delete cascade,
    label text not null default 'Home',
    street text not null,
    barangay text not null,
    city text not null,
    province text not null,
    postal_code text not null,
    country text not null default 'Philippines'
  );
  create table order_lines (
    id integer primary key generated always as identity,
    order_id integer not null references orders (id) on delete cascade,
    product_name text not null,
    size_label text not null default '',
    price_in_centavos integer not null default 0,
    quantity integer not null default 1
  );
  create table order_feedback (
    order_id integer primary key references orders (id) on delete cascade,
    rating integer not null,
    comment text not null,
    created_at timestamptz not null default now(),
    sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
    sentiment_model text,
    sentiment_analyzed_at timestamptz
  );
  create table feedback_analysis_runs (
    id integer primary key generated always as identity,
    started_by_kind text not null,
    started_by_id text,
    started_by_name text,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    analyzed integer not null default 0,
    failed integer not null default 0,
    model text
  );
  create table feedback_top_product (
    id integer primary key default 1 check (id = 1),
    product_name text not null,
    feedback_count integer not null,
    reason text not null,
    model text not null,
    computed_at timestamptz not null
  );
  create table feedback_requests (
    order_id integer primary key references orders (id) on delete cascade,
    customer_id text not null references customers (id),
    sent_at timestamptz not null default now()
  );
  create table tickets (
    id integer primary key generated always as identity,
    customer_id text not null references customers (id),
    subject text not null,
    category text not null default 'Other',
    order_id integer references orders (id),
    status text not null default 'open',
    priority text not null default 'normal',
    claimed_by_id text,
    claimed_by_name text,
    hold_reason text,
    hold_note text,
    hold_until timestamptz,
    hold_started_at timestamptz,
    held_seconds integer not null default 0,
    follow_up_of_id integer references tickets (id),
    rating integer check (rating is null or rating between 1 and 5),
    rating_comment text,
    rated_at timestamptz,
    resolved_at timestamptz,
    created_at timestamptz not null default now()
  );
  create function tickets_track_hold() returns trigger as $$
  begin
    if NEW.status = 'on_hold' and OLD.status is distinct from 'on_hold' then
      NEW.hold_started_at := now();
    elsif OLD.status = 'on_hold' and NEW.status <> 'on_hold' then
      NEW.held_seconds := OLD.held_seconds + greatest(0, floor(extract(epoch from now() - coalesce(OLD.hold_started_at, now()))))::integer;
      NEW.hold_started_at := null;
    end if;
    return NEW;
  end;
  $$ language plpgsql;
  create trigger tickets_track_hold before update of status on tickets
    for each row execute function tickets_track_hold();
  create table ticket_messages (
    id integer primary key generated always as identity,
    ticket_id integer not null references tickets (id) on delete cascade,
    sender text not null,
    body text not null,
    attachment_pathname text,
    file_id text,
    internal boolean not null default false,
    author_name text,
    created_at timestamptz not null default now()
  );
`;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

export interface TestDatabase {
  sql: postgres.Sql;
  close: () => Promise<void>;
}

/** An in-memory Postgres with the Ticket tables, reached through a real postgres.js client. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const db = await PGlite.create();
  await db.exec(SCHEMA);
  await db.exec(readFileSync(new URL("./returns-schema.sql", import.meta.url), "utf8"));
  await db.exec(`create table order_cancellations (
    id uuid primary key, order_id integer not null unique references orders(id) on delete cascade,
    reason text not null, actor_type text not null, actor_id text not null, actor_name text not null,
    status text not null default 'waiting-manager', approval_status text not null default 'waiting-manager', decline_reason text, stock_outcome text, refund_method text, refund_proof_file_id text,
    created_at timestamptz not null default now()
  )`);
  await db.exec(`create table order_cancel_requests (
    id uuid primary key, order_id integer not null references orders(id) on delete cascade, reason text not null,
    status text not null default 'waiting', requested_by_id text not null default 'c1', requested_by_name text not null default 'Maria Santos',
    decided_by_id text, decided_by_name text, decline_reason text, decided_at timestamptz, created_at timestamptz not null default now()
  )`);
  await db.exec(`create table failed_deliveries (
    id text primary key, order_id integer not null references orders(id), reason text not null, next_step text not null,
    customer_message text not null, staff_id text not null, staff_name text not null, created_at timestamptz not null default now(),
    disposition text, disposed_at timestamptz, rebooked_at timestamptz, courier jsonb
  )`);

  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();

  const sql = postgres({ host: "127.0.0.1", port: port, database: "postgres", username: "postgres", max: 1 });

  return {
    sql,
    close: async () => {
      await sql.end();
      await server.stop();
      await db.close();
    },
  };
}
