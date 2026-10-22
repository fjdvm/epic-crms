import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { describeNotification } from "@/features/notifications/describe";
import { viewerFor } from "@/features/notifications/load";
import { listNotifications, markAllRead, markRead } from "@/features/notifications/notifications";
import { syncOrderEvents } from "@/features/notifications/order-events";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

/** The real crms DDL, minus the role and schema creation PGlite has no use for. */
function crmsStatements(): string[] {
  return readFileSync("docs/db/crms-schema.sql", "utf8")
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !/^(create role|grant|set role|reset role|revoke)/i.test(s))
    // Start with the pre-Orders schema to exercise the upgrade used by existing installs.
    .filter((s) => !/^create table crms\.(seen_order_events|order_sync_state)/i.test(s))
    .map((s) => s.replace(", 'order-delivery-fee', 'order-payment-proof'", ""))
    .map((s) => s.replace(/^(create schema \w+) authorization \w+/i, "$1"));
}

beforeAll(async () => {
  db = await startTestDatabase();
  for (const statement of crmsStatements()) await db.sql.unsafe(statement);
  await db.sql.unsafe(readFileSync("docs/db/crms-order-notifications.sql", "utf8"));
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.sql`truncate order_feedback, orders, customers restart identity cascade`;
  await db.sql`truncate crms.notifications, crms.seen_order_events, crms.order_sync_state restart identity`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Jane Doe', 'jane@example.com')`;
});

// The reader and the writer are one connection here; production uses two roles on one database.
const sync = () => syncOrderEvents(db.sql, db.sql);

const staff = { username: "ada" };
const ordersViewer = () => viewerFor(staff, ["/orders"])!;

async function order() {
  const [row] = await db.sql<{ id: number }[]>`
    insert into orders (customer_id) values ('c1') returning id`;
  return row.id;
}

describe("Order notifications", () => {
  it("alerts every Staff member with the Orders Module when a Delivery Order needs a fee", async () => {
    await sync();
    const id = await order();
    expect(await sync()).toEqual({ baselined: false, created: 1 });

    for (const username of ["ada", "ben"]) {
      const feed = await listNotifications(db.sql, "crms", 20, viewerFor({ username }, ["/orders"])!);
      expect(feed.unread).toBe(1);
      expect(feed.notifications).toMatchObject([
        { kind: "order-delivery-fee", orderId: id, customerId: "c1", customerName: "Jane Doe" },
      ]);
    }
  });

  it("alerts Payments Staff when a Customer submits proof on an existing GCash Order", async () => {
    const id = await order();
    await db.sql`update orders set payment_method = 'gcash', status = 'confirmed' where id = ${id}`;
    await sync();
    await db.sql`update orders set status = 'awaiting payment', gcash_reference_number = '1234567890',
      payment_proof_submitted_at = now() where id = ${id}`;
    expect(await sync()).toEqual({ baselined: false, created: 1 });

    for (const username of ["ada", "ben"]) {
      const viewer = viewerFor({ username }, ["/payments"])!;
      const feed = await listNotifications(db.sql, "crms", 20, viewer);
      expect(feed.unread).toBe(1);
      expect(feed.notifications).toMatchObject([{ kind: "order-payment-proof", orderId: id }]);
    }
    expect((await listNotifications(db.sql, "crms", 20, ordersViewer())).notifications).toEqual([]);
  });

  it("says why Staff are needed and opens the Order detail", async () => {
    await sync();
    const id = await order();
    await sync();
    const { notifications } = await listNotifications(db.sql, "crms", 20, ordersViewer());
    expect(describeNotification(notifications[0])).toEqual({
      text: `Jane Doe placed Order #${id}, which needs a Delivery fee`, href: `/orders/${id}`,
    });
  });

  it("baselines existing Delivery Orders and Payment proofs without a flood", async () => {
    await order();
    const id = await order();
    await db.sql`update orders set payment_method = 'gcash', status = 'awaiting payment',
      payment_proof_submitted_at = now() where id = ${id}`;
    expect(await sync()).toEqual({ baselined: true, created: 0 });
    expect(await sync()).toEqual({ baselined: false, created: 0 });
    const viewer = viewerFor(staff, ["/orders", "/payments"])!;
    expect(await listNotifications(db.sql, "crms", 20, viewer)).toEqual({ unread: 0, notifications: [] });
  });

  it("raises no Delivery fee alert for Pickup, already quoted or progressed Orders", async () => {
    await sync();
    const pickup = await order();
    const quoted = await order();
    const confirmed = await order();
    await db.sql`update orders set fulfillment_method = 'pickup' where id = ${pickup}`;
    await db.sql`update orders set delivery_fee_in_centavos = 0 where id = ${quoted}`;
    await db.sql`update orders set status = 'confirmed' where id = ${confirmed}`;
    expect(await sync()).toEqual({ baselined: false, created: 0 });
  });

  it("needs an actual GCash proof submission, even if the Order awaits payment", async () => {
    await sync();
    const noProof = await order();
    const cod = await order();
    await db.sql`update orders set status = 'awaiting payment'`;
    await db.sql`update orders set payment_method = 'gcash', gcash_reference_number = '123' where id = ${noProof}`;
    await db.sql`update orders set payment_proof_submitted_at = now() where id = ${cod}`;
    expect(await sync()).toEqual({ baselined: false, created: 0 });
  });

  it("keeps both events once across repeated and concurrent syncs and later Order progress", async () => {
    await sync();
    const id = await order();
    await Promise.all([sync(), sync(), sync()]);
    await db.sql`update orders set payment_method = 'gcash', status = 'paid',
      payment_proof_submitted_at = now() where id = ${id}`;
    await Promise.all([sync(), sync(), sync()]);
    await sync();
    const viewer = viewerFor(staff, ["/orders", "/payments"])!;
    const feed = await listNotifications(db.sql, "crms", 20, viewer);
    expect(feed.unread).toBe(2);
    expect(feed.notifications.map((n) => n.kind).sort()).toEqual(["order-delivery-fee", "order-payment-proof"]);
    expect(describeNotification(feed.notifications[0])).toEqual({
      text: `Jane Doe submitted Payment proof for Order #${id}`, href: `/orders/${id}`,
    });
  });

  it("never shows or clears Order alerts for Staff without the matching Module", async () => {
    await sync();
    const id = await order();
    await db.sql`update orders set payment_method = 'gcash', payment_proof_submitted_at = now() where id = ${id}`;
    await sync();
    const both = viewerFor(staff, ["/orders", "/payments"])!;
    const feed = await listNotifications(db.sql, "crms", 20, both);
    for (const pages of [["/fulfilment"], ["/feedback"], ["/tickets"], ["/customer-profiles"]]) {
      const viewer = viewerFor(staff, pages) ?? {
        customerProfiles: false, ticketsStaffId: null, feedback: false, orders: false, payments: false,
      };
      expect(await listNotifications(db.sql, "crms", 20, viewer)).toEqual({ unread: 0, notifications: [] });
      await markRead(db.sql, feed.notifications[0].id, "crms", viewer);
      await markAllRead(db.sql, "crms", viewer);
    }
    expect((await listNotifications(db.sql, "crms", 20, both)).unread).toBe(2);
    const orders = await listNotifications(db.sql, "crms", 20, ordersViewer());
    expect(orders.notifications.map((n) => n.kind)).toEqual(["order-delivery-fee"]);
    await markRead(db.sql, orders.notifications[0].id, "crms", viewerFor(staff, ["/payments"])!);
    expect((await listNotifications(db.sql, "crms", 20, both)).unread).toBe(2);
    await markAllRead(db.sql, "crms", ordersViewer());
    expect((await listNotifications(db.sql, "crms", 20, both)).unread).toBe(1);
    await markRead(db.sql, feed.notifications.find((n) => n.kind === "order-payment-proof")!.id, "crms", viewerFor(staff, ["/payments"])!);
    expect((await listNotifications(db.sql, "crms", 20, both)).unread).toBe(0);
    expect(viewerFor(staff, ["/fulfilment"])).toBeNull();
    expect(viewerFor(staff, [])).toBeNull();
  });
});
