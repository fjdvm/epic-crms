import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

const NOT_FOUND = new Error("NEXT_NOT_FOUND");
const mocks = vi.hoisted(() => ({ db: undefined as unknown, role: "staff" }));

vi.mock("next/navigation", () => ({ notFound: () => { throw NOT_FOUND; } }));
vi.mock("@/lib/db", () => ({ database: () => mocks.db }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => mocks.db }));
vi.mock("@/lib/portal/staff", () => ({
  requireModule: async () => ({ id: "u1", name: "U", role: mocks.role }),
  heldModules: async () => [],
  canOpenOrders: async () => false,
}));

import CustomerProfilePage from "@/app/(app)/customer-profiles/[id]/page";

let db: TestDatabase;
const SINCE = new Date("2026-01-05T00:00:00Z");

beforeAll(async () => {
  db = await startTestDatabase();
  mocks.db = db.sql;
  const { sql } = db;
  await sql.unsafe(`alter table customers add column middle_name text, add column last_name text not null default '', add column contact_number text not null default '';
  create table addresses (
    id integer primary key generated always as identity,
    customer_id text not null references customers (id),
    label text not null default '', street text not null default '', barangay text not null default '',
    city text not null default '', province text not null default '', postal_code text not null default '',
    country text not null default 'PH', is_default boolean not null default false
  );
  create table products (slug text primary key, name text not null);
  create table sizes (id integer primary key generated always as identity, product_slug text not null references products (slug), label text not null, price_in_centavos integer not null default 0);
  create table cart_lines (
    id integer primary key generated always as identity,
    customer_id text not null references customers (id),
    size_id integer not null references sizes (id),
    quantity integer not null default 1
  );`);
  await sql`insert into neon_auth."user" (id, "emailVerified", "createdAt") values ('gone', true, ${SINCE})`;
  await sql`insert into customers (id, full_name, first_name, last_name, email, contact_number)
    values ('gone', 'Gone Gina', 'Gone', 'Gina', 'gone@x.ph', '+63917')`;
  await sql`update customers set deleted_at = now() where id = 'gone'`;
});
afterAll(() => db.close());

describe("Customer Details of a Deleted Customer (#533)", () => {
  it.each(["staff", "manager", "admin", "ceo"])("is not found for %s", async (role) => {
    mocks.role = role;
    await expect(CustomerProfilePage({ params: Promise.resolve({ id: "gone" }) })).rejects.toBe(NOT_FOUND);
  });
});
