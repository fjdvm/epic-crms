import postgres from "postgres";
import { afterEach, afterAll, describe, expect, it, vi } from "vitest";

import { loadCustomerProfile, getCustomerProfile } from "@/features/customer-profiles/profile";

// Runs against the real shared database through the read-only role. Skipped when no
// connection string is supplied. Every statement here is a SELECT; nothing is written.
const url = process.env.CREOMS_DATABASE_URL;
const sql = url ? postgres(url, { max: 2 }) : (undefined as unknown as postgres.Sql);

afterAll(async () => {
  if (url) await sql.end();
});

afterEach(() => vi.restoreAllMocks());

const NOW = new Date();

/** Written out here on purpose, so a wrong status list in the module cannot pass both sides. */
const COUNTS_TOWARD_TOTAL_SPENT = new Set(["paid", "preparing", "dispatched", "delivered"]);

describe("loadCustomerProfile", () => {
  it("reports unavailable instead of throwing when the database cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await loadCustomerProfile(() => {
      throw new Error("CREOMS_DATABASE_URL is not set; see .env.example");
    }, "anyone");

    expect(result).toEqual({ ok: false });
  });
});

describe.skipIf(!url)("getCustomerProfile (real database)", () => {
  it("matches an independent query for every Customer, including header, stats and Details", async () => {
    const customers = await sql`select * from public.customers`;
    const users = await sql`select id::text as id, "emailVerified" as verified, "createdAt" as created from neon_auth."user"`;
    const orders = await sql`select id, customer_id, status, subtotal_in_centavos, delivery_fee_in_centavos, created_at from public.orders`;
    const feedback = await sql`select order_id, rating from public.order_feedback`;
    const addresses = await sql`select * from public.addresses order by id`;
    const lines = await sql`select * from public.order_lines`;
    const snapshots = await sql`select * from public.order_delivery_addresses`;
    const allOrders = await sql`select * from public.orders`;

    const verified = customers.filter((c) => users.find((u) => u.id === c.id)?.verified);
    expect(verified.length, "needs at least one Customer").toBeGreaterThan(0);

    for (const c of verified) {
      const user = users.find((u) => u.id === c.id)!;
      const mine = orders.filter((o) => o.customer_id === c.id);
      const paid = mine.filter((o) => COUNTS_TOWARD_TOTAL_SPENT.has(o.status));
      const total = (o: (typeof mine)[number]) => o.subtotal_in_centavos + (o.delivery_fee_in_centavos ?? 0);
      const spent = paid.reduce((sum, o) => sum + total(o), 0);
      const counted = mine.filter((o) => o.status !== "cancelled");
      const ratings = feedback.filter((f) => mine.some((o) => o.id === f.order_id)).map((f) => f.rating);
      const mineAddresses = addresses.filter((a) => a.customer_id === c.id);

      const got = await getCustomerProfile(sql, c.id, NOW);
      expect(got, `${c.id} must be found`).not.toBeNull();
      const p = got!;

      expect(p.name).toBe(c.full_name);
      expect(p.email).toBe(c.email);
      expect(p.contactNumber).toBe(c.contact_number);
      expect(p.firstName).toBe(c.first_name);
      expect(p.middleName).toBe(c.middle_name ?? null);
      expect(p.lastName).toBe(c.last_name);
      expect(p.marketingOptIn).toBe(c.marketing_opt_in);
      expect(p.customerSince.getTime()).toBe(user.created.getTime());
      expect(p.defaultCity).toBe(mineAddresses.find((a) => a.is_default)?.city ?? null);

      expect(p.orders).toBe(mine.length);
      expect(p.totalSpent).toBe(spent);
      expect(p.averageOrder).toBe(paid.length ? Math.round(spent / paid.length) : null);
      expect(p.lastOrder?.getTime() ?? null).toBe(
        counted.length ? Math.max(...counted.map((o) => o.created_at.getTime())) : null,
      );
      expect(p.feedbackCount).toBe(ratings.length);
      expect(p.averageRating).toBe(
        ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
      );

      const wantOrders = [...mine].sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id - a.id);
      expect(p.orderHistory.map((o) => o.id)).toEqual(wantOrders.map((o) => o.id));
      for (const o of p.orderHistory) {
        const w = mine.find((x) => x.id === o.id)!;
        expect(o.total).toBe(total(w));
        expect(o.subtotal).toBe(w.subtotal_in_centavos);
        expect(o.deliveryFee).toBe(w.delivery_fee_in_centavos ?? null);
        expect(o.status).toBe(w.status);
        expect(o.createdAt.getTime()).toBe(w.created_at.getTime());
        const src = allOrders.find((x) => x.id === o.id)!;
        expect(o.fulfillmentMethod).toBe(src.fulfillment_method);
        expect(o.paymentMethod).toBe(src.payment_method);
        expect(o.paymentProof?.screenshot ?? null).toBe(
          src.payment_method === "gcash" ? (src.payment_proof_screenshot_pathname ?? null) : null,
        );
        expect(o.lines.map((l) => [l.product, l.size, l.quantity, l.price])).toEqual(
          lines.filter((l) => l.order_id === o.id).sort((a, b) => a.id - b.id)
            .map((l) => [l.product_name, l.size_label, l.quantity, l.price_in_centavos]),
        );
        const snap = snapshots.find((s) => s.order_id === o.id);
        expect(o.address).toEqual(
          snap
            ? { label: snap.label, street: snap.street, barangay: snap.barangay, city: snap.city,
                province: snap.province, postalCode: snap.postal_code, country: snap.country }
            : null,
        );
        const fb = feedback.find((f) => f.order_id === o.id);
        expect(o.feedback?.rating ?? null).toBe(fb?.rating ?? null);
        const pr = allOrders.find((x) => x.id === o.id)!;
        expect(o.paymentProof?.reference ?? null).toBe(
          pr.payment_method === "gcash" ? pr.gcash_reference_number : null,
        );
      }

      expect(p.addresses.map((a) => a.id)).toEqual(mineAddresses.map((a) => a.id));
      for (const a of p.addresses) {
        const w = mineAddresses.find((x) => x.id === a.id)!;
        expect(a).toEqual({
          id: w.id,
          label: w.label,
          street: w.street,
          barangay: w.barangay,
          city: w.city,
          province: w.province,
          postalCode: w.postal_code,
          country: w.country,
          isDefault: w.is_default,
        });
      }
    }
  });

  it("finds nothing for a Lead or an id that does not exist", async () => {
    const leads = await sql`
      select c.id from public.customers c
      join neon_auth."user" u on u.id::text = c.id
      where not u."emailVerified"`;

    for (const lead of leads) {
      expect(await getCustomerProfile(sql, lead.id, NOW)).toBeNull();
    }
    expect(await getCustomerProfile(sql, "no-such-customer", NOW)).toBeNull();
  });
});
