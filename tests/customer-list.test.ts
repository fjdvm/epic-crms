import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { listCustomers, STAGES } from "@/features/customer-profiles/customers";

// Runs against the real shared database through the read-only role. Skipped when no
// connection string is supplied. Every statement here is a SELECT; nothing is written.
const url = process.env.CREOMS_DATABASE_URL;
const sql = url ? postgres(url, { max: 2 }) : (undefined as unknown as postgres.Sql);

afterAll(async () => {
  if (url) await sql.end();
});

const NOW = new Date();

/** Written out here on purpose, so a wrong status list in the module cannot pass both sides. */
const COUNTS_TOWARD_TOTAL_SPENT = new Set(["paid", "preparing", "dispatched", "delivered"]);

/** Written out here too, not imported: whole days since the last non-cancelled Order. */
function stageFor(orders: number, lastOrder: Date | null): string {
  if (orders === 0 || !lastOrder) return "new";
  const days = (NOW.getTime() - lastOrder.getTime()) / (24 * 60 * 60 * 1000);
  if (days >= 120) return "lost";
  if (days >= 60) return "at-risk";
  return orders === 1 ? "first-order" : "repeat";
}

/** Independent expectation: plain per-table reads, aggregated in JS with the domain rules. */
async function expected() {
  const customers = await sql`select * from public.customers`;
  const users = await sql`select id::text as id, "emailVerified" as verified, "createdAt" as created from neon_auth."user"`;
  const orders = await sql`select customer_id, status, subtotal_in_centavos, delivery_fee_in_centavos, created_at from public.orders`;
  const carts = await sql`select distinct customer_id from public.cart_lines`;

  return customers
    .flatMap((c) => {
      const user = users.find((u) => u.id === c.id);
      return user?.verified ? [{ c, user }] : [];
    })
    .map(({ c, user }) => {
      const mine = orders.filter((o) => o.customer_id === c.id);
      const counted = mine.filter((o) => o.status !== "cancelled");
      const lastOrder = counted.length ? new Date(Math.max(...counted.map((o) => o.created_at.getTime()))) : null;
      return {
        id: c.id as string,
        name: c.full_name as string,
        email: c.email as string,
        contactNumber: c.contact_number as string,
        orders: mine.length,
        totalSpent: mine
          .filter((o) => COUNTS_TOWARD_TOTAL_SPENT.has(o.status))
          .reduce((sum, o) => sum + o.subtotal_in_centavos + (o.delivery_fee_in_centavos ?? 0), 0),
        lastOrder: lastOrder?.getTime() ?? null,
        stage: stageFor(counted.length, lastOrder),
        cartHasItems: carts.some((x) => x.customer_id === c.id),
        customerSince: user.created.getTime(),
      };
    });
}

describe.skipIf(!url)("listCustomers (real database)", () => {
  it("lists exactly the verified Customers with every column matching an independent query", async () => {
    const want = await expected();
    const got = await listCustomers(sql, { pageSize: 1000, now: NOW });

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

    const byOrders = await listCustomers(sql, { sort: "orders", direction: "asc", pageSize: 1000 });
    const counts = byOrders.rows.map((r) => r.orders);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it("searches name, email and contact number on the server", async () => {
    const all = (await listCustomers(sql, { pageSize: 1000 })).rows;
    expect(all.length, "needs at least one Customer to search for").toBeGreaterThan(0);
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

  it("tabs filter the list server-side and each count matches its rows", async () => {
    const want = await expected();
    const all = await listCustomers(sql, { pageSize: 1000, now: NOW });

    for (const stage of STAGES) {
      const tab = await listCustomers(sql, { stage, pageSize: 1000, now: NOW });
      const ids = want.filter((w) => w.stage === stage).map((w) => w.id).sort();

      expect(tab.rows.map((r) => r.id).sort()).toEqual(ids);
      expect(tab.matching).toBe(ids.length);
      expect(all.stageCounts[stage]).toBe(ids.length);
    }
  });
});
