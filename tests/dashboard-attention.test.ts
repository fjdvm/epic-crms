import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadAttention } from "@/features/dashboard/attention";
import { loadDashboardFigures } from "@/features/dashboard/figures";
import { resolvePeriod } from "@/features/dashboard/period";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date("2026-10-25T07:00:00Z");
const period = resolvePeriod("today", now);
const connect = () => db.sql;

beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate order_returns, order_feedback, ticket_messages, tickets, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
});

interface OrderSpec {
  status: string; at?: string; method?: string; payment?: string; subtotal?: number; fee?: number | null; proofAt?: string | null;
}

async function order(spec: OrderSpec) {
  const [row] = await db.sql<{ id: number }[]>`insert into orders
    (customer_id, status, fulfillment_method, payment_method, subtotal_in_centavos, delivery_fee_in_centavos,
     payment_proof_submitted_at, created_at)
    values ('c1', ${spec.status}, ${spec.method ?? "delivery"}, ${spec.payment ?? "cash-on-delivery"},
      ${spec.subtotal ?? 100000}, ${spec.fee ?? null}, ${spec.proofAt ? new Date(spec.proofAt) : null},
      ${new Date(spec.at ?? "2026-10-20T00:00:00Z")}) returning id`;
  return row.id;
}

async function ticket(opts: { status?: string; claimed?: boolean; lastFrom?: "customer" | "staff" | null; at: string }) {
  const [row] = await db.sql<{ id: number }[]>`insert into tickets (customer_id, subject, status, claimed_by_id, created_at)
    values ('c1', 'Help', ${opts.status ?? "open"}, ${opts.claimed ? "s1" : null}, ${new Date(opts.at)}) returning id`;
  if (opts.lastFrom) {
    await db.sql`insert into ticket_messages (ticket_id, sender, body, created_at)
      values (${row.id}, ${opts.lastFrom}, 'hi', ${new Date(opts.at)})`;
  }
}

async function attention(modules: string[]) {
  return (await loadDashboardFigures(connect, { period, modules, now })).attention;
}

const ALL = ["Payments", "Orders", "Fulfilment", "Tickets", "Returns", "Feedback"];

describe("Payment proofs to check", () => {
  it("counts GCash Orders awaiting a check, with the oldest proof's time", async () => {
    await order({ status: "awaiting payment", payment: "gcash", proofAt: "2026-10-24T02:00:00Z" });
    await order({ status: "awaiting payment", payment: "gcash", proofAt: "2026-10-23T02:00:00Z" });
    await order({ status: "awaiting payment", payment: "gcash", proofAt: null });
    await order({ status: "paid", payment: "gcash", proofAt: "2026-10-01T02:00:00Z" });

    expect((await attention(ALL))?.paymentProofs).toEqual({ ok: true, count: 2, oldest: new Date("2026-10-23T02:00:00Z") });
  });

  it("is zero with no oldest when the queue is clear", async () => {
    expect((await attention(ALL))?.paymentProofs).toEqual({ ok: true, count: 0, oldest: null });
  });
});

describe("Delivery fees to quote", () => {
  it("counts placed Delivery Orders only", async () => {
    await order({ status: "placed", at: "2026-10-22T00:00:00Z" });
    await order({ status: "placed", at: "2026-10-23T00:00:00Z" });
    await order({ status: "placed", method: "pickup" });
    await order({ status: "confirmed", fee: 5000 });

    expect((await attention(ALL))?.deliveryFees).toEqual({ ok: true, count: 2, oldest: new Date("2026-10-22T00:00:00Z") });
  });
});

describe("Orders to pack", () => {
  it("counts paid Orders and confirmed Cash on Delivery Orders", async () => {
    await order({ status: "paid", payment: "gcash", at: "2026-10-21T00:00:00Z" });
    await order({ status: "confirmed", payment: "cash-on-delivery", at: "2026-10-22T00:00:00Z" });
    await order({ status: "confirmed", payment: "gcash" });
    await order({ status: "preparing" });

    expect((await attention(ALL))?.ordersToPack).toEqual({ ok: true, count: 2, oldest: new Date("2026-10-21T00:00:00Z") });
  });
});

describe("COD to collect", () => {
  it("counts open Cash on Delivery Orders and totals them in centavos with the Delivery fee", async () => {
    await order({ status: "confirmed", subtotal: 100000, fee: 15000, at: "2026-10-20T00:00:00Z" });
    await order({ status: "dispatched", subtotal: 50000, fee: null });
    await order({ status: "delivered", subtotal: 70000 });
    await order({ status: "confirmed", payment: "gcash" });

    expect((await attention(ALL))?.codToCollect).toEqual({
      ok: true, count: 2, oldest: new Date("2026-10-20T00:00:00Z"), centavos: 165000,
    });
  });
});

describe("Open Tickets", () => {
  it("counts unclaimed Open Tickets as the Tickets page does, and how many are Overdue", async () => {
    await ticket({ lastFrom: "customer", at: "2026-10-23T00:00:00Z" }); // Overdue
    await ticket({ lastFrom: null, at: "2026-10-24T00:00:00Z" }); // new, unanswered, Overdue
    await ticket({ lastFrom: "customer", at: "2026-10-25T05:00:00Z" }); // recent
    await ticket({ lastFrom: "staff", at: "2026-10-01T00:00:00Z" }); // waiting on the Customer: never Overdue
    await ticket({ lastFrom: "customer", at: "2026-10-01T00:00:00Z", claimed: true });
    await ticket({ lastFrom: "customer", at: "2026-10-01T00:00:00Z", status: "resolved" });

    expect((await attention(ALL))?.openTickets).toEqual({
      ok: true, count: 4, overdue: 2, oldest: new Date("2026-10-23T00:00:00Z"),
    });
  });
});

describe("Returns to decide", () => {
  it("counts Requested Returns only", async () => {
    const id = await order({ status: "received" });
    await db.sql`insert into order_returns (order_id, status, reason, amount_in_centavos, requested_at) values
      (${id}, 'requested', 'damaged', 1, ${new Date("2026-10-22T00:00:00Z")}),
      (${id}, 'requested', 'damaged', 1, ${new Date("2026-10-24T00:00:00Z")}),
      (${id}, 'approved', 'damaged', 1, ${new Date("2026-10-01T00:00:00Z")})`;

    expect((await attention(ALL))?.returns).toEqual({ ok: true, count: 2, oldest: new Date("2026-10-22T00:00:00Z") });
  });
});

describe("Low Feedback to review", () => {
  it("counts Feedback of 1 to 3 stars", async () => {
    for (const [rating, at] of [[1, "2026-10-21"], [3, "2026-10-22"], [4, "2026-10-01"], [5, "2026-10-01"]] as const) {
      const id = await order({ status: "received" });
      await db.sql`insert into order_feedback (order_id, rating, comment, created_at) values (${id}, ${rating}, 'x', ${new Date(at)})`;
    }

    expect((await attention(ALL))?.lowFeedback).toEqual({ ok: true, count: 2, oldest: new Date("2026-10-21") });
  });
});

describe("Needs attention", () => {
  it("withholds each queue from Staff without its Module", async () => {
    expect(await attention([])).toEqual({});
    expect(Object.keys((await attention(["Payments"]))!)).toEqual(["paymentProofs"]);
    expect(Object.keys((await attention(["Orders"]))!)).toEqual(["deliveryFees", "cancelRequests", "overdueOrders"]);
    expect(Object.keys((await attention(["Fulfilment"]))!).sort()).toEqual(["codToCollect", "ordersToPack"]);
    expect(Object.keys((await attention(["Tickets"]))!)).toEqual(["openTickets"]);
    expect(Object.keys((await attention(["Returns"]))!)).toEqual(["returns"]);
    expect(Object.keys((await attention(["Feedback"]))!)).toEqual(["lowFeedback"]);
  });

  it("is live: the next read sees a change at once", async () => {
    expect((await attention(ALL))?.deliveryFees).toMatchObject({ count: 0 });
    await order({ status: "placed" });
    expect((await attention(ALL))?.deliveryFees).toMatchObject({ count: 1 });
  });

  it("fails one queue without failing the others", async () => {
    let calls = 0;
    const flaky = () => {
      if (++calls === 2) throw new Error("offline");
      return db.sql;
    };

    const result = await loadAttention(flaky, { modules: ["Returns", "Feedback"], now });

    expect(result.returns).toMatchObject({ ok: true });
    expect(result.lowFeedback).toEqual({ ok: false });
  });
});

describe("Orders Overdue to confirm", () => {
  // `now` is 2026-10-25T07:00Z, so the default 48 hour limit falls at 2026-10-23T07:00Z.
  const overdue = async (hours?: number | null) =>
    (await loadDashboardFigures(connect, { period, modules: ALL, now, unconfirmedHours: hours })).attention?.overdueOrders;

  it("counts Orders still placed past the limit, whatever the payment method or fulfilment", async () => {
    await order({ status: "placed", at: "2026-10-23T06:59:00Z", payment: "gcash" });
    await order({ status: "placed", at: "2026-10-20T00:00:00Z", method: "pickup" });
    await order({ status: "placed", at: "2026-10-23T07:00:00Z" });

    expect(await overdue()).toEqual({ ok: true, count: 3, oldest: new Date("2026-10-20T00:00:00Z") });
  });

  it("leaves out Orders inside the limit and Orders that are confirmed or cancelled", async () => {
    await order({ status: "placed", at: "2026-10-23T07:01:00Z" });
    await order({ status: "confirmed", at: "2026-10-20T00:00:00Z" });
    await order({ status: "awaiting payment", at: "2026-10-20T00:00:00Z", payment: "gcash" });
    await order({ status: "cancelled", at: "2026-10-20T00:00:00Z" });

    expect(await overdue()).toEqual({ ok: true, count: 0, oldest: null });
  });

  it("clears when the Order is confirmed", async () => {
    const id = await order({ status: "placed", at: "2026-10-20T00:00:00Z" });
    expect((await overdue() as { count: number }).count).toBe(1);
    await db.sql`update orders set status = 'confirmed' where id = ${id}`;
    expect((await overdue() as { count: number }).count).toBe(0);
  });

  it("follows the Admin's limit and shows nothing when the rule is off", async () => {
    await order({ status: "placed", at: "2026-10-24T00:00:00Z" });

    expect((await overdue() as { count: number }).count).toBe(0);
    expect((await overdue(24) as { count: number }).count).toBe(1);
    expect((await overdue(null) as { count: number }).count).toBe(0);
  });

  it("never cancels anything", async () => {
    const id = await order({ status: "placed", at: "2026-10-01T00:00:00Z" });
    await overdue();
    const [row] = await db.sql<{ status: string }[]>`select status from orders where id = ${id}`;
    expect(row.status).toBe("placed");
  });

  it("is hidden from Staff without the Orders Module", async () => {
    await order({ status: "placed", at: "2026-10-20T00:00:00Z" });
    const result = (await loadDashboardFigures(connect, { period, modules: ["Returns"], now })).attention;
    expect(result?.overdueOrders).toBeUndefined();
  });
});

describe("Payment reviews for a Manager", () => {
  // `now` is 2026-10-25T07:00Z, so the default 48 hour target falls at 2026-10-23T07:00Z.
  const reviews = async (opts: { manager?: boolean; hours?: number | null } = {}) =>
    (await loadAttention(connect, { modules: ["Payments"], now, targets: undefined, manager: opts.manager ?? true, reviewHours: opts.hours === undefined ? 48 : opts.hours })).paymentReviews;
  const inReview = async (rejectedAt: string, rejections = 3, status = "awaiting payment") => {
    const id = await order({ status, payment: "gcash", proofAt: "2026-10-20T00:00:00Z" });
    await db.sql`update orders set payment_proof_rejections = ${rejections}, payment_proof_rejected_at = ${new Date(rejectedAt)} where id = ${id}`;
  };

  it("lists Orders after the third rejection and counts the Overdue ones; the others are left out", async () => {
    await inReview("2026-10-23T06:00:00Z");
    await inReview("2026-10-24T06:00:00Z");
    await inReview("2026-10-20T00:00:00Z", 2);
    await inReview("2026-10-20T00:00:00Z", 3, "cancelled");
    await inReview("2026-10-20T00:00:00Z", 3, "paid");

    expect(await reviews()).toEqual({ ok: true, count: 2, oldest: new Date("2026-10-23T06:00:00Z"), overdue: 1 });
  });

  it("stays listed without an Overdue count when the rule is off, and is hidden from non-Managers", async () => {
    await inReview("2026-10-20T00:00:00Z");

    expect(await reviews({ hours: null })).toMatchObject({ count: 1, overdue: 0 });
    expect(await reviews({ manager: false })).toBeUndefined();
  });
});
