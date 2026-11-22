import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadCustomers, listCustomers } from "@/features/customer-profiles/customers";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const SINCE = new Date("2026-01-05T00:00:00Z");

beforeAll(async () => {
  db = await startTestDatabase();
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
  for (const [id, name] of [["kept", "Kept Kim"], ["gone", "Gone Gina"]]) {
    await sql`insert into neon_auth."user" (id, "emailVerified", "createdAt") values (${id}, true, ${SINCE})`;
    await sql`insert into customers (id, full_name, first_name, last_name, email, contact_number)
      values (${id}, ${name}, ${name.split(" ")[0]}, ${name.split(" ")[1]}, ${id + "@x.ph"}, '+63917')`;
  }
  await sql`update customers set deleted_at = now() where id = 'gone'`;
});
afterAll(() => db.close());

describe("Customer List hides Deleted Customers (#532)", () => {
  it("excludes a marked Customer from the list, count and search, with the same result for every role", async () => {
    // The list takes no role: Staff, Manager, Admin and CEO all read this one query.
    const result = await loadCustomers(() => db.sql, {} as never);
    expect(result.ok && result.list.rows.map((r) => r.id)).toEqual(["kept"]);
    expect(result.ok && result.list.profileCount).toBe(1);
    expect((await listCustomers(db.sql, { search: "gone" })).rows).toEqual([]);
  });

  it("shows them again once the mark is cleared", async () => {
    await db.sql`update customers set deleted_at = null where id = 'gone'`;
    expect((await listCustomers(db.sql)).rows.map((r) => r.id).sort()).toEqual(["gone", "kept"]);
  });
});
