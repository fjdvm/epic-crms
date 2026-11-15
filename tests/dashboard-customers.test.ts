import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDashboardFigures } from "@/features/dashboard/figures";
import { resolvePeriod } from "@/features/dashboard/period";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date("2026-10-25T07:00:00Z");
const today = resolvePeriod("today", now);
let clock = Date.now();
const figures = (modules = ["Customer Profiles"], period = today, at = now) =>
  loadDashboardFigures(() => db.sql, { modules, period, now: at });

beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { vi.restoreAllMocks(); await db.close(); });
beforeEach(async () => {
  vi.restoreAllMocks();
  clock += 300_001;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await db.sql`truncate customers, neon_auth."user" restart identity cascade`;
});

async function customer(id: string, verified = true, since = "2026-01-01T00:00:00Z") {
  await db.sql`insert into customers (id, full_name, email) values (${id}, ${id}, ${`${id}@example.com`})`;
  await db.sql`insert into neon_auth."user" (id, "emailVerified", "createdAt")
    values (${id}, ${verified}, ${new Date(since)})`;
}

async function order(id: string, at: string, status = "placed") {
  await db.sql`insert into orders (customer_id, created_at, status) values (${id}, ${new Date(at)}, ${status})`;
}

describe("Dashboard Customers", () => {
  it("uses non-cancelled Orders for Stage, with At risk and Lost taking precedence, independent of the period", async () => {
    for (const id of ["new", "cancelled", "first", "repeat", "risk-one", "risk-repeat", "lost-one", "lost-repeat"])
      await customer(id);
    await order("cancelled", "2026-10-25T01:00:00Z", "cancelled");
    await order("first", "2026-10-25T01:00:00Z");
    await order("repeat", "2026-10-24T01:00:00Z", "paid");
    await order("repeat", "2026-10-25T01:00:00Z");
    // Exactly 60 and 120 days before now. Cancelled Orders do not reset the clock.
    for (const id of ["risk-one", "risk-repeat"]) await order(id, "2026-08-26T07:00:00Z");
    await order("risk-repeat", "2026-08-01T00:00:00Z");
    await order("risk-one", "2026-10-25T01:00:00Z", "cancelled");
    for (const id of ["lost-one", "lost-repeat"]) await order(id, "2026-06-27T07:00:00Z");
    await order("lost-repeat", "2026-06-01T00:00:00Z");

    const result = await figures();
    expect(result.customersByStage).toEqual({ ok: true, counts: {
      new: 2, "first-order": 1, repeat: 1, "at-risk": 2, lost: 2,
    } });
    expect(result.atRisk).toEqual({ ok: true, count: 2 });
    const other = await figures(["Customer Profiles"], resolvePeriod("last-month", now));
    expect(other.customersByStage).toEqual(result.customersByStage);
    expect(other.atRisk).toEqual(result.atRisk);
  });

  it("compares verified Customers by sign-up date across Philippine period boundaries", async () => {
    await customer("previous-start", true, "2026-10-23T16:00:00Z");
    await customer("previous-end", true, "2026-10-24T15:59:59Z");
    await customer("current-start", true, "2026-10-24T16:00:00Z");
    await customer("current-end", true, "2026-10-25T15:59:59Z");
    await customer("current-middle", true, "2026-10-25T01:00:00Z");
    await customer("outside-before", true, "2026-10-23T15:59:59Z");
    await customer("outside-after", true, "2026-10-25T16:00:00Z");
    await customer("old-signup-verified-today", true, "2026-01-01T00:00:00Z");
    await customer("lead", false, "2026-10-25T01:00:00Z");

    expect((await figures()).newCustomers).toEqual({ ok: true, current: 3, previous: 2 });
  });


  it("keeps unverified Leads separate and excludes accounts with no storefront identity from every Customers figure", async () => {
    await customer("verified", true, "2026-10-25T01:00:00Z");
    await customer("lead-today", false, "2026-10-25T01:00:00Z");
    await customer("lead-old", false);
    // A Lead with an Order still is not a Customer.
    await order("lead-today", "2026-10-25T01:00:00Z");
    // A customer row with no auth identity.
    await db.sql`insert into customers (id, full_name, email) values ('walk', 'Unverified', 'walk@example.com')`;
    const result = await figures();
    expect(result.customersByStage).toEqual({ ok: true, counts: {
      new: 1, "first-order": 0, repeat: 0, "at-risk": 0, lost: 0,
    } });
    expect(result.atRisk).toEqual({ ok: true, count: 0 });
    expect(result.newCustomers).toEqual({ ok: true, current: 1, previous: 0 });
    expect(result.unverifiedLeads).toEqual({ ok: true, count: 2 });
  });


  it.each([{ modules: ["Orders", "Payments", "Feedback", "Dashboard"] }, { modules: [] }])("withholds all Customers figures without Customer Profiles: $modules", async ({ modules }) => {
    const result = await figures(modules);
    for (const key of ["customersByStage", "atRisk", "newCustomers", "unverifiedLeads"])
      expect(result).not.toHaveProperty(key);
  });

  it("returns zero counts for an empty storefront", async () => {
    const result = await figures();
    expect(result.customersByStage).toEqual({ ok: true, counts: {
      new: 0, "first-order": 0, repeat: 0, "at-risk": 0, lost: 0,
    } });
    expect(result.atRisk).toEqual({ ok: true, count: 0 });
    expect(result.newCustomers).toEqual({ ok: true, current: 0, previous: 0 });
    expect(result.unverifiedLeads).toEqual({ ok: true, count: 0 });
  });

  it("a failing Stage read leaves sign-ups and Leads available and is retried after recovery", async () => {
    await customer("verified", true, "2026-10-25T01:00:00Z");
    await customer("lead", false);
    await db.sql`alter table orders rename to unavailable_orders`;
    try {
      const result = await figures();
      expect(result.customersByStage).toEqual({ ok: false });
      expect(result.atRisk).toEqual({ ok: false });
      expect(result.newCustomers).toEqual({ ok: true, current: 1, previous: 0 });
      expect(result.unverifiedLeads).toEqual({ ok: true, count: 1 });
    } finally {
      await db.sql`alter table unavailable_orders rename to orders`;
    }
    expect((await figures()).customersByStage).toMatchObject({ ok: true, counts: { new: 1 } });
  });

  it("caches Customers analytics for five minutes", async () => {
    const before = await figures();
    await customer("verified", true, "2026-10-25T01:00:00Z");
    await customer("lead", false);
    clock += 299_999;
    expect(await figures()).toEqual(before);
    clock += 2;
    const after = await figures();
    expect(after.customersByStage).toMatchObject({ counts: { new: 1 } });
    expect(after.newCustomers).toMatchObject({ current: 1 });
    expect(after.unverifiedLeads).toMatchObject({ count: 1 });
  });

  it("refreshes today's Stage after Philippine midnight even when the picker stays on last month", async () => {
    const beforeMidnight = new Date("2026-10-25T15:59:00Z");
    const afterMidnight = new Date("2026-10-25T16:01:00Z");
    await customer("risk");
    await order("risk", "2026-08-26T16:00:00Z");
    const lastMonth = resolvePeriod("last-month", beforeMidnight);
    expect((await figures(["Customer Profiles"], lastMonth, beforeMidnight)).atRisk).toEqual({ ok: true, count: 0 });
    clock += 120_000;
    expect((await figures(["Customer Profiles"], lastMonth, afterMidnight)).atRisk).toEqual({ ok: true, count: 1 });
  });

});
