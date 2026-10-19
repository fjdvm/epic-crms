import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { listCustomers } from "@/features/customer-profiles/customers";
import { isCustomer, totalSpent } from "@/features/customer-profiles/rules";

// Runs against the real shared database through the read-only role. Skipped when no
// connection string is supplied. Every statement here is a SELECT; nothing is written.
const url = process.env.CREOMS_DATABASE_URL;
const sql = url ? postgres(url, { max: 2 }) : (undefined as unknown as postgres.Sql);

afterAll(async () => {
  if (url) await sql.end();
});

/** Independent expectation: plain per-table reads, aggregated in JS with the domain rules. */
async function expected() {
  const customers = await sql`select * from public.customers`;
  const users = await sql`select id::text as id, "emailVerified" as verified, "createdAt" as created from neon_auth."user"`;
  const orders = await sql`select customer_id, status, subtotal_in_centavos, delivery_fee_in_centavos, created_at from public.orders`;
  const carts = await sql`select distinct customer_id from public.cart_lines`;

  return customers
    .filter((c) => isCustomer(users.find((u) => u.id === c.id) ? { emailVerified: users.find((u) => u.id === c.id)!.verified } : null))
    .map((c) => {
      const mine = orders.filter((o) => o.customer_id === c.id);
      return {
        id: c.id as string,
        name: c.full_name as string,
        email: c.email as string,
        contactNumber: c.contact_number as string,
        orders: mine.length,
        totalSpent: totalSpent(
          mine.map((o) => ({
            status: o.status,
            subtotalInCentavos: o.subtotal_in_centavos,
            deliveryFeeInCentavos: o.delivery_fee_in_centavos,
          })),
        ),
        lastOrder: mine.length ? Math.max(...mine.map((o) => o.created_at.getTime())) : null,
        cartHasItems: carts.some((x) => x.customer_id === c.id),
        customerSince: users.find((u) => u.id === c.id)!.created.getTime(),
      };
    });
}

describe.skipIf(!url)("listCustomers (real database)", () => {
  it("lists exactly the verified Customers with every column matching an independent query", async () => {
    const want = await expected();
    const got = await listCustomers(sql, { pageSize: 1000 });

    expect(got.profileCount).toBe(want.length);
    expect(got.rows).toHaveLength(want.length);

    for (const row of got.rows) {
      const w = want.find((x) => x.id === row.id);
      expect(w, `Lead ${row.id} must not appear`).toBeDefined();
      expect({
        ...row,
        lastOrder: row.lastOrder?.getTime() ?? null,
        customerSince: row.customerSince.getTime(),
      }).toEqual(w);
    }
  });

  it("sorts newest Customer first by default and honours sort direction", async () => {
    const byDefault = await listCustomers(sql, { pageSize: 1000 });
    const times = byDefault.rows.map((r) => r.customerSince.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const byName = await listCustomers(sql, { sort: "name", direction: "asc", pageSize: 1000 });
    const names = byName.rows.map((r) => r.name.toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  it("searches name, email and contact number on the server", async () => {
    const all = (await listCustomers(sql, { pageSize: 1000 })).rows;
    if (all.length === 0) return;
    const target = all[0];

    for (const term of [target.name.slice(1, 4), target.email, target.contactNumber]) {
      const found = await listCustomers(sql, { search: term, pageSize: 1000 });
      expect(found.rows.map((r) => r.id)).toContain(target.id);
      const lower = term.toLowerCase();
      for (const r of found.rows) {
        expect(
          [r.name, r.email, r.contactNumber].some((f) => f.toLowerCase().includes(lower)),
        ).toBe(true);
      }
      expect(found.profileCount).toBe(all.length);
    }

    const none = await listCustomers(sql, { search: "zzz-no-such-customer-%_" });
    expect(none.rows).toEqual([]);
    expect(none.matching).toBe(0);
  });

  it("paginates without overlap and clamps out-of-range pages", async () => {
    const all = (await listCustomers(sql, { pageSize: 1000 })).rows;
    const seen: string[] = [];
    const first = await listCustomers(sql, { pageSize: 2, page: 1 });

    for (let p = 1; p <= first.totalPages; p++) {
      seen.push(...(await listCustomers(sql, { pageSize: 2, page: p })).rows.map((r) => r.id));
    }
    expect(seen).toEqual(all.map((r) => r.id));

    const beyond = await listCustomers(sql, { pageSize: 2, page: 999 });
    expect(beyond.page).toBe(first.totalPages);
  });
});
