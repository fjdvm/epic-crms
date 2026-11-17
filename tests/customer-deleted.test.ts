import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listCustomers } from "@/features/customer-profiles/customers";
import { getCustomerProfile } from "@/features/customer-profiles/profile";
import { customersByStageAt } from "@/features/dashboard/customers";
import { listOrders } from "@/features/orders/orders";
import { searchCustomers } from "@/features/tickets/new-ticket";
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
  );
`);
  for (const [id, name] of [["kept", "Kept Kim"], ["gone", "Gone Gina"]]) {
    await sql`insert into neon_auth."user" (id, "emailVerified", "createdAt") values (${id}, true, ${SINCE})`;
    await sql`insert into customers (id, full_name, first_name, last_name, email, contact_number)
      values (${id}, ${name}, ${name.split(" ")[0]}, ${name.split(" ")[1]}, ${id + "@x.ph"}, '+63917')`;
    await sql`insert into orders (customer_id, status, subtotal_in_centavos) values (${id}, 'delivered', 50000)`;
  }
});
afterAll(() => db.close());

describe("Deleted customers in Customer Profiles", () => {
  it("are hidden from the list and counts, and come back on restore with Customer since unchanged", async () => {
    await db.sql`update customers set deleted_at = now() where id = 'gone'`;

    const hidden = await listCustomers(db.sql);
    expect(hidden.rows.map((r) => r.id)).toEqual(["kept"]);
    expect(hidden.profileCount).toBe(1);
    expect(await listCustomers(db.sql, { search: "Gina" })).toMatchObject({ matching: 0, rows: [] });
    expect(await getCustomerProfile(db.sql, "gone")).toBeNull();
    expect(Object.values((await customersByStageAt(db.sql, new Date())).counts).reduce((a, b) => a + b, 0)).toBe(1);

    await db.sql`update customers set deleted_at = null where id = 'gone'`;
    const back = await listCustomers(db.sql);
    expect(back.profileCount).toBe(2);
    expect((await getCustomerProfile(db.sql, "gone"))?.customerSince).toEqual(SINCE);
  });

  it("keep their Orders visible under a Deleted customer tag, and cannot be picked for a new Ticket", async () => {
    await db.sql`update customers set deleted_at = now() where id = 'gone'`;
    try {
      const orders = await listOrders(db.sql);
      expect(orders.rows.map((r) => r.customerName).sort()).toEqual(["Deleted customer", "Kept Kim"]);
      expect(await searchCustomers(db.sql, "x.ph")).toMatchObject([{ id: "kept" }]);
    } finally {
      await db.sql`update customers set deleted_at = null where id = 'gone'`;
    }
  });
});
