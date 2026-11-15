import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadFulfilmentReport } from "@/features/reports/fulfilment-report";
import { resolvePeriod } from "@/features/dashboard/period";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date("2026-10-25T07:00:00Z");
const today = resolvePeriod("today", now); // 2026-10-25 00:00 PHT = 2026-10-24T16:00Z
const connect = () => db.sql;

beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate order_returns, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
});

async function order(o: { status?: string; placed: string; dispatched?: string; delivered?: string; replacementFor?: number }) {
  const [row] = await db.sql<{ id: number }[]>`insert into orders
    (customer_id, status, created_at, dispatched_at, delivered_at, replacement_for_order_id)
    values ('c1', ${o.status ?? "delivered"}, ${new Date(o.placed)}, ${o.dispatched ? new Date(o.dispatched) : null},
      ${o.delivered ? new Date(o.delivered) : null}, ${o.replacementFor ?? null}) returning id`;
  return row.id;
}
const report = (role: string) => loadFulfilmentReport(connect, { role, period: today });
const HOUR = 3600;

describe("Fulfilment report figures", () => {
  it("averages placed to dispatched and dispatched to delivered, in seconds", async () => {
    await order({ placed: "2026-10-25T00:00:00Z", dispatched: "2026-10-25T02:00:00Z", delivered: "2026-10-25T05:00:00Z" });
    await order({ placed: "2026-10-25T01:00:00Z", dispatched: "2026-10-25T05:00:00Z", delivered: "2026-10-25T06:00:00Z" });

    const result = await report("Manager");
    expect(result).toMatchObject({ ok: true, figures: { placedToDispatched: 3 * HOUR, dispatchedToDelivered: 2 * HOUR } });
  });

  it("has no average when nothing was dispatched or delivered in the period", async () => {
    await order({ status: "placed", placed: "2026-10-25T01:00:00Z" });
    const result = await report("Manager");
    expect(result).toMatchObject({ ok: true, figures: { placedToDispatched: null, dispatchedToDelivered: null } });
  });

  it("dates each figure by Philippine Time", async () => {
    // 2026-10-24T15:30Z is 23:30 on the 24th in Manila: yesterday, not today.
    await order({ placed: "2026-10-24T10:00:00Z", dispatched: "2026-10-24T15:30:00Z", delivered: "2026-10-24T16:30:00Z" });
    await order({ placed: "2026-10-24T16:00:00Z", dispatched: "2026-10-24T17:00:00Z", delivered: "2026-10-24T19:00:00Z" });

    const result = await report("Manager");
    expect(result).toMatchObject({ ok: true, figures: { placedToDispatched: HOUR, dispatchedToDelivered: 1.5 * HOUR } });
  });

  it("computes the cancellation rate over Orders placed in the period", async () => {
    await order({ status: "cancelled", placed: "2026-10-25T01:00:00Z" });
    await order({ status: "paid", placed: "2026-10-25T02:00:00Z" });
    await order({ status: "paid", placed: "2026-10-25T03:00:00Z" });
    await order({ status: "paid", placed: "2026-10-25T04:00:00Z" });
    await order({ status: "cancelled", placed: "2026-10-20T04:00:00Z" });

    const result = await report("CEO");
    expect(result).toMatchObject({ ok: true, figures: { cancellationRate: 0.25, placed: 4 } });
  });

  it("computes the return rate over Orders delivered in the period, ignoring Customer-cancelled Returns", async () => {
    const a = await order({ placed: "2026-10-24T20:00:00Z", dispatched: "2026-10-24T21:00:00Z", delivered: "2026-10-25T01:00:00Z" });
    const b = await order({ placed: "2026-10-24T20:00:00Z", dispatched: "2026-10-24T21:00:00Z", delivered: "2026-10-25T02:00:00Z" });
    await order({ placed: "2026-10-24T20:00:00Z", dispatched: "2026-10-24T21:00:00Z", delivered: "2026-10-25T03:00:00Z" });
    await order({ placed: "2026-10-24T20:00:00Z", dispatched: "2026-10-24T21:00:00Z", delivered: "2026-10-25T04:00:00Z" });
    for (const [id, status] of [[a, "refunded"], [a, "requested"], [b, "cancelled"]] as const) {
      await db.sql`insert into order_returns (order_id, status, reason, amount_in_centavos) values (${id}, ${status}, 'damaged', 100)`;
    }

    const result = await report("Admin");
    expect(result).toMatchObject({ ok: true, figures: { returnRate: 0.25, delivered: 4 } });
  });

  it("has no rates when there were no Orders", async () => {
    expect(await report("Manager")).toMatchObject({ ok: true, figures: { cancellationRate: null, returnRate: null } });
  });

  it("excludes Replacement Orders from every figure", async () => {
    const original = await order({ placed: "2026-10-25T00:00:00Z", dispatched: "2026-10-25T01:00:00Z", delivered: "2026-10-25T02:00:00Z" });
    await order({ status: "cancelled", placed: "2026-10-25T01:00:00Z", replacementFor: original });
    await order({ placed: "2026-10-25T00:00:00Z", dispatched: "2026-10-25T09:00:00Z", delivered: "2026-10-25T20:00:00Z", replacementFor: original });

    const result = await report("Manager");
    expect(result).toMatchObject({ ok: true, figures: {
      placedToDispatched: HOUR, dispatchedToDelivered: HOUR, cancellationRate: 0, placed: 1, delivered: 1 } });
  });

  describe("access", () => {
    it.each(["Manager", "Admin", "CEO"])("lets the %s read it", async (role) => {
      expect((await report(role)).ok).toBe(true);
    });

    it.each(["Staff", "Staff / Employee", "Unknown Role"])("refuses %s without reading any data", async (role) => {
      await db.sql`insert into orders (customer_id) values ('c1')`;
      expect(await report(role)).toEqual({ ok: false, reason: "forbidden" });
    });

    it("reads Portal role names such as CREOMS Manager and Super Admin", async () => {
      expect((await report("CREOMS Manager")).ok).toBe(true);
      expect((await report("Super Admin")).ok).toBe(true);
    });
  });
});
