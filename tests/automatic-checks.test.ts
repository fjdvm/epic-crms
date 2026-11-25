import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadUnusualActivity } from "@/features/dashboard/unusual-activity";
import { codFlags } from "@/features/orders/cod-flags";
import { paymentProofChecksForOrders, reusedReferenceOrderIds } from "@/features/orders/payment-proof-checks";
import { frequentReturnsFlag } from "@/features/returns/return-flags";
import {
  DEFAULT_AUTOMATIC_CHECKS, loadAutomaticChecks, resolveAutomaticChecks, validateAutomaticChecks, type AutomaticChecks,
} from "@/features/settings/automatic-checks";
import { saveAutomaticChecks } from "@/features/settings/automatic-checks-server";

import { startTestDatabase, type TestDatabase } from "./ticket-database";
import { expectOnlyFailureEvents } from "./settings-audit-helpers";

let db: TestDatabase;
const audit = vi.fn(async () => {});
const admin = { id: "a1", name: "Ada Admin", role: "CEO" };
const manager = { id: "m1", name: "Mario", role: "CRMS Manager" };
const edit = (change: (c: AutomaticChecks) => void) => { const c = structuredClone(DEFAULT_AUTOMATIC_CHECKS); change(c); return c; };
const now = new Date("2026-11-16T08:00:00Z");

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql`alter table customers add column contact_number text`;
  await db.sql.unsafe(readFileSync("docs/db/crms-cod-settings.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-automatic-checks.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-unusual-activity.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  audit.mockClear();
  await db.sql`update crms.automatic_checks set settings = '{}'::jsonb, changed_by_id = null, changed_by_name = null`;
  await db.sql`update crms.cod_settings set first_order_amount_in_centavos = 150000`;
  await db.sql`truncate failed_deliveries, order_payment_proofs, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria', 'maria@example.com')`;
});

describe("defaults", () => {
  it("equal today's behaviour, with every rule on", () => {
    expect(DEFAULT_AUTOMATIC_CHECKS).toEqual({
      paymentProof: { reference: { enabled: true }, amount: { enabled: true }, date: { enabled: true }, recipient: { enabled: true } },
      cod: {
        firstOrder: { enabled: true }, firstOrderOverAmount: { enabled: true, amountInCentavos: 150000 },
        earlierRefusal: { enabled: true }, earlierFailedDelivery: { enabled: true },
      },
      returns: { frequentReturns: { enabled: true, count: 3, days: 90 }, reusedPhoto: { enabled: true } },
      dashboard: {
        unverifiedPayments: { enabled: true, count: 5, waitHours: 24 }, returnSpike: { enabled: true, count: 3, days: 7 },
        unresolvedFailedDeliveries: { enabled: true, count: 3 }, unconfirmedOrders: { enabled: true, hours: 48 }, paymentReviews: { enabled: true, hours: 48 },
      },
    });
  });

  it("are what is read when nothing was ever saved, and when the saved value is junk", async () => {
    expect(await loadAutomaticChecks(db.sql)).toEqual(DEFAULT_AUTOMATIC_CHECKS);
    expect(resolveAutomaticChecks({ cod: { firstOrder: { enabled: "no" }, returns: 5 }, dashboard: { returnSpike: { count: -2 } } })).toEqual(DEFAULT_AUTOMATIC_CHECKS);
  });

  it("have no Senior/PWD duplicate-ID setting", () => {
    expect(JSON.stringify(DEFAULT_AUTOMATIC_CHECKS)).not.toMatch(/senior|pwd/i);
  });
});

describe("saving", () => {
  it("is for a Manager or the CEO: Staff and Admin are refused and nothing is saved or audited", async () => {
    for (const role of ["Staff/Employee", "Super Admin"]) {
      const result = await saveAutomaticChecks(db.sql, audit, { ...manager, role }, edit(c => { c.cod.firstOrder.enabled = false; }));
      expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/^Only a Manager/) });
    }
    expect(await loadAutomaticChecks(db.sql)).toEqual(DEFAULT_AUTOMATIC_CHECKS);
    expectOnlyFailureEvents(audit);
  });

  it("keeps a switch and a number, and audits the change under the Admin's name", async () => {
    const next = edit(c => { c.cod.firstOrder.enabled = false; c.returns.frequentReturns.count = 4; c.cod.firstOrderOverAmount.amountInCentavos = 200000; });
    expect(await saveAutomaticChecks(db.sql, audit, admin, next)).toEqual({ ok: true, checks: next });
    expect(await loadAutomaticChecks(db.sql)).toEqual(next);
    const [cod] = await db.sql`select first_order_amount_in_centavos::int as amount from crms.cod_settings`;
    expect(cod.amount).toBe(200000);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "automatic_checks.changed", actor: expect.objectContaining({ display_name: "Ada Admin" }),
      description: expect.stringContaining("Ada Admin changed the Automatic checks: First order, First order over an amount, Many Returns by one Customer"),
    }));
  });

  it("refuses an out-of-range number or a missing rule with a plain reason", async () => {
    const zero = edit(c => { c.dashboard.returnSpike.count = 0; });
    expect(await saveAutomaticChecks(db.sql, audit, admin, zero)).toMatchObject({ ok: false, reason: expect.stringContaining("Returns on one product") });
    expect(validateAutomaticChecks({ cod: {} })).toMatchObject({ ok: false });
    expectOnlyFailureEvents(audit);
  });
});

describe("the evaluators read the settings", () => {
  const cod = async (settings: AutomaticChecks) => {
    const [o] = await db.sql`insert into orders (customer_id, subtotal_in_centavos, payment_method) values ('c1', 200000, 'cash-on-delivery') returning id`;
    return (await codFlags(db.sql, [o.id], settings.cod)).get(o.id);
  };

  it("raises the COD rules as before by default", async () => {
    expect(await cod(DEFAULT_AUTOMATIC_CHECKS)).toEqual(["first-order", "first-order-over-amount"]);
  });
  it("drops a switched-off COD rule", async () => {
    expect(await cod(edit(c => { c.cod.firstOrder.enabled = false; }))).toEqual(["first-order-over-amount"]);
  });
  it("uses an edited amount", async () => {
    expect(await cod(edit(c => { c.cod.firstOrderOverAmount.amountInCentavos = 200000; }))).toEqual(["first-order"]);
  });

  it("applies an edited Returns count and window, and ignores the rule when off", () => {
    const self = { id: 4, requestedAt: new Date("2026-11-01") };
    const same = [1, 2, 3].map(id => ({ id, requestedAt: new Date(`2026-10-0${id}`), status: "requested" }));
    expect(frequentReturnsFlag(self, same, { count: 4, days: 90 })).not.toBeNull();
    expect(frequentReturnsFlag(self, same, { count: 5, days: 90 })).toBeNull();
    expect(frequentReturnsFlag(self, same, { count: 4, days: 20 })).toBeNull();
  });

  describe("proof checks", () => {
    async function twoOrdersSharingAReference() {
      const ids: number[] = [];
      for (let i = 0; i < 2; i++) {
        const [o] = await db.sql`insert into orders (customer_id, subtotal_in_centavos, payment_method, status, gcash_reference_number)
          values ('c1', 100, 'gcash', 'awaiting payment', 'REF1') returning id`;
        await db.sql`insert into order_payment_proofs (order_id, reference, confirmed_amount_in_centavos) values (${o.id}, 'REF1', 5)`;
        ids.push(o.id);
      }
      return ids;
    }

    it("flag reference reuse and a wrong amount by default, and stop when switched off", async () => {
      const [first, second] = await twoOrdersSharingAReference();
      const on = [...(await paymentProofChecksForOrders(db.sql, [second])).values()][0].checks;
      expect(on.reference).toMatchObject({ pass: false, otherOrderIds: [first] });
      expect(on.amount.pass).toBe(false);

      const off = edit(c => { c.paymentProof.reference.enabled = false; c.paymentProof.amount.enabled = false; });
      const checks = [...(await paymentProofChecksForOrders(db.sql, [second], off)).values()][0].checks;
      expect(checks.reference).toMatchObject({ pass: true, otherOrderIds: [] });
      expect(checks.amount.pass).toBe(true);
      expect(await reusedReferenceOrderIds(db.sql, second, off)).toEqual([]);
      expect(await reusedReferenceOrderIds(db.sql, second)).toEqual([first]);
    });
  });

  describe("dashboard counts", () => {
    const staff = { id: "s1", name: "Rhea", username: "rhea", email: "r@example.com", role: "CREOMS Manager" };
    const open = () => loadUnusualActivity({ source: db.sql, crms: db.sql }, staff, ["Payments", "Fulfilment"], now);
    const unverified = async (n: number) => {
      for (let i = 0; i < n; i++)
        await db.sql`insert into orders (customer_id, status, payment_method, payment_proof_submitted_at) values ('c1', 'awaiting payment', 'gcash', ${now})`;
    };

    it("uses an edited number and is silent when switched off", async () => {
      await unverified(3);
      expect((await open()).cards).toEqual([]);
      await saveAutomaticChecks(db.sql, audit, admin, edit(c => { c.dashboard.unverifiedPayments.count = 2; }));
      expect((await open()).cards[0]).toMatchObject({ key: "unverified-payments", numbers: { count: 3 } });
      await saveAutomaticChecks(db.sql, audit, admin, edit(c => { c.dashboard.unverifiedPayments.count = 2; c.dashboard.unverifiedPayments.enabled = false; }));
      expect((await open()).cards).toEqual([]);
    });

    it("labels failed deliveries as unresolved, not as a window of days", async () => {
      for (let i = 0; i < 3; i++) {
        const [o] = await db.sql`insert into orders (customer_id, status, fulfillment_method) values ('c1', 'dispatched', 'delivery') returning id`;
        await db.sql`insert into failed_deliveries (id, order_id, reason, next_step, customer_message, staff_id, staff_name)
          values (${crypto.randomUUID()}, ${o.id}, 'x', 'rebook', 'hi', 's', 'S')`;
      }
      const card = (await open()).cards.find(c => c.key === "failed-deliveries")!;
      expect(card.rule).toMatch(/unresolved Failed deliveries/);
      expect(card.rule).not.toMatch(/days/);
      expect(card.numbers).toEqual({ count: 3 });
    });
  });
});
