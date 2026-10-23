import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { describeNotification } from "@/features/notifications/describe";
import { viewerFor } from "@/features/notifications/load";
import { listNotifications, markAllRead, markRead } from "@/features/notifications/notifications";
import { syncReturnEvents } from "@/features/notifications/return-events";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
  const statements = readFileSync("docs/db/crms-schema.sql", "utf8")
    .replace(/^--.*$/gm, "").split(";").map(s => s.trim())
    .filter(s => s && !/^(create role|grant|set role|reset role|revoke)/i.test(s))
    // Reconstruct an existing install and exercise the actual upgrade twice.
    .filter(s => !/^create table crms\.(seen_returns|return_sync_state)/i.test(s))
    .map(s => s.replace(", 'return-requested'", "").replace(/return_id\s+integer,/, ""))
    .map(s => s.replace(/^(create schema \w+) authorization \w+/i, "$1"));
  for (const statement of statements) await db.sql.unsafe(statement);
  const migration = readFileSync("docs/db/crms-return-notifications.sql", "utf8");
  await db.sql.unsafe(migration);
  await db.sql.unsafe(migration);
}, 60_000);

afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate customers restart identity cascade`;
  await db.sql`truncate crms.notifications, crms.seen_returns, crms.return_sync_state restart identity`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Jane Doe', 'jane@example.com')`;
  await db.sql`insert into orders (customer_id, status) values ('c1', 'delivered')`;
});

const sync = () => syncReturnEvents(db.sql, db.sql);
const viewer = (username = "ada", pages = ["/returns"]) => viewerFor({ username }, pages)!;
async function request() {
  const [row] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, reason, amount_in_centavos)
    values (1, 'damaged', 10000) returning id`;
  return row.id;
}

describe("Return notifications", () => {
  it("alerts every Staff member with the Returns Module when a Return is Requested", async () => {
    await sync();
    const id = await request();
    expect(await sync()).toEqual({ baselined: false, created: 1 });
    for (const username of ["ada", "ben"]) {
      const feed = await listNotifications(db.sql, "crms", 20, viewer(username));
      expect(feed.unread).toBe(1);
      expect(feed.notifications).toMatchObject([
        { kind: "return-requested", returnId: id, orderId: 1, customerId: "c1", customerName: "Jane Doe" },
      ]);
      expect(describeNotification(feed.notifications[0])).toEqual({
        text: `Jane Doe requested Return RMA-${id}`, href: "/orders/1",
      });
    }
  });

  it("baselines existing Returns without notifying Staff", async () => {
    await request();
    expect(await sync()).toEqual({ baselined: true, created: 0 });
    expect(await sync()).toEqual({ baselined: false, created: 0 });
    expect(await listNotifications(db.sql, "crms", 20, viewer())).toEqual({ unread: 0, notifications: [] });
  });

  it("never shows or clears Return alerts without the Returns Module, including after revocation", async () => {
    await sync();
    await request();
    await sync();
    const feed = await listNotifications(db.sql, "crms", 20, viewer());
    for (const page of ["/orders", "/payments", "/fulfilment", "/tickets", "/feedback", "/customer-profiles"]) {
      const withoutReturns = viewer("ada", [page]) ?? {
        customerProfiles: false, ticketsStaffId: null, feedback: false, orders: false, payments: false, returns: false,
      };
      expect(await listNotifications(db.sql, "crms", 20, withoutReturns)).toEqual({ unread: 0, notifications: [] });
      await markRead(db.sql, feed.notifications[0].id, "crms", withoutReturns);
      await markAllRead(db.sql, "crms", withoutReturns);
    }
    expect(viewerFor({ username: "ada" }, [])).toBeNull();
    expect((await listNotifications(db.sql, "crms", 20, viewer())).unread).toBe(1);
    await markRead(db.sql, feed.notifications[0].id, "crms", viewer());
    expect((await listNotifications(db.sql, "crms", 20, viewer())).unread).toBe(0);
    await request();
    await sync();
    await markAllRead(db.sql, "crms", viewer());
    expect((await listNotifications(db.sql, "crms", 20, viewer())).unread).toBe(0);
  });

  it("keeps one notification across repeated and concurrent syncs and all later steps", async () => {
    await sync();
    await request();
    const results = await Promise.all([sync(), sync(), sync()]);
    expect(results.reduce((total, result) => total + result.created, 0)).toBe(1);
    for (const status of ["approved", "goods received", "refunded", "declined", "cancelled"]) {
      await db.sql`update order_returns set status = ${status}`;
      expect(await sync()).toEqual({ baselined: false, created: 0 });
    }
    expect((await listNotifications(db.sql, "crms", 20, viewer())).notifications).toHaveLength(1);
  });

  it("retains the original request if a Return progresses between polls", async () => {
    await sync();
    await request();
    await db.sql`update order_returns set status = 'refunded', refunded_at = now()`;
    expect(await sync()).toEqual({ baselined: false, created: 1 });
    expect(await sync()).toEqual({ baselined: false, created: 0 });
    expect((await listNotifications(db.sql, "crms", 20, viewer())).notifications).toMatchObject([
      { kind: "return-requested", returnId: 1 },
    ]);
  });

  it("notifies once for each Return even when two Returns belong to the same Order", async () => {
    await sync();
    await request();
    await request();
    expect(await sync()).toEqual({ baselined: false, created: 2 });
    const feed = await listNotifications(db.sql, "crms", 20, viewer());
    expect(feed.notifications.map(n => n.returnId).sort()).toEqual([1, 2]);
  });

});
