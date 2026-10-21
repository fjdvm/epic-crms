import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createServer } from "node:net";
import postgres from "postgres";

/**
 * The slice of the ecommerce schema the Tickets pages read, as the ecommerce migrations leave it
 * (drizzle 0014 and 0015). CREOMS never migrates these tables; this mirrors them for tests only.
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
    email text not null
  );
  create table orders (
    id integer primary key generated always as identity,
    customer_id text not null references customers (id),
    status text not null default 'placed',
    subtotal_in_centavos integer not null default 0,
    delivery_fee_in_centavos integer,
    created_at timestamptz not null default now()
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
    resolved_at timestamptz,
    created_at timestamptz not null default now()
  );
  create table ticket_messages (
    id integer primary key generated always as identity,
    ticket_id integer not null references tickets (id) on delete cascade,
    sender text not null,
    body text not null,
    attachment_pathname text,
    file_id text,
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
