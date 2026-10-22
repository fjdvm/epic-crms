import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { viewerFor } from "@/features/notifications/load";
import { listNotifications, type Viewer } from "@/features/notifications/notifications";
import { syncFeedbackEvents } from "@/features/notifications/feedback-events";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

/** The real crms DDL, minus the role and schema creation PGlite has no use for. */
function crmsStatements(): string[] {
  return readFileSync("docs/db/crms-schema.sql", "utf8")
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !/^(create role|grant|set role|reset role|revoke)/i.test(s))
    .map((s) => s.replace(/^(create schema \w+) authorization \w+/i, "$1"));
}

beforeAll(async () => {
  db = await startTestDatabase();
  for (const statement of crmsStatements()) await db.sql.unsafe(statement);
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.sql`truncate order_feedback, orders, customers restart identity cascade`;
  await db.sql`truncate crms.notifications, crms.seen_feedback, crms.feedback_sync_state restart identity`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Jane Doe', 'jane@example.com')`;
});

// The reader and the writer are one connection here; production uses two roles on one database.
const sync = () => syncFeedbackEvents(db.sql, db.sql);

const withFeedbackModule = { customerProfiles: false, ticketsStaffId: null, feedback: true, orders: false, payments: false };
const withTicketsModule = { customerProfiles: false, ticketsStaffId: "ada", feedback: false, orders: false, payments: false };
const withProfilesModule = { customerProfiles: true, ticketsStaffId: null, feedback: false, orders: false, payments: false };

async function alertsFor(viewer: Viewer) {
  const feed = await listNotifications(db.sql, "crms", 20, viewer);

  return feed.notifications.map((n) => `${n.kind}:${n.orderId}:${n.rating}`).sort();
}

/** A Delivered Order of Jane's with Feedback of the given stars. */
async function feedback(rating: number, createdAt: Date = new Date()) {
  const [{ id }] = await db.sql<{ id: number }[]>`
    insert into orders (customer_id, status) values ('c1', 'delivered') returning id`;
  await db.sql`insert into order_feedback (order_id, rating, comment, created_at)
    values (${id}, ${rating}, 'It was fine', ${createdAt})`;

  return id;
}

describe("Feedback notifications", () => {
  it("raises nothing for Feedback that was there before the first sync", async () => {
    await feedback(1);

    expect(await sync()).toEqual({ baselined: true, created: 0 });
    expect(await alertsFor(withFeedbackModule)).toEqual([]);
  });

  it.each([1, 2, 3])("alerts Staff with the Feedback Module for %i stars", async (stars) => {
    await sync();
    const order = await feedback(stars);

    expect(await sync()).toEqual({ baselined: false, created: 1 });
    expect(await alertsFor(withFeedbackModule)).toEqual([`feedback-low:${order}:${stars}`]);
  });

  it.each([4, 5])("raises nothing for %i stars", async (stars) => {
    await sync();
    await feedback(stars);

    expect(await sync()).toEqual({ baselined: false, created: 0 });
    expect(await alertsFor(withFeedbackModule)).toEqual([]);
  });

  it("does not alert Staff without the Feedback Module, whatever else they can open", async () => {
    await sync();
    await feedback(2);
    await sync();

    expect(await alertsFor(withTicketsModule)).toEqual([]);
    expect(await alertsFor(withProfilesModule)).toEqual([]);
  });

  it("shows Staff with both Modules the Feedback alert once, and Tickets-only Staff never", async () => {
    await sync();
    const order = await feedback(1);
    await sync();

    const both = { customerProfiles: false, ticketsStaffId: "ada", feedback: true, orders: false, payments: false };
    const feed = await listNotifications(db.sql, "crms", 20, both);

    expect(feed.notifications.map((n) => n.orderId)).toEqual([order]);
    expect(feed.unread).toBe(1);
    expect((await listNotifications(db.sql, "crms", 20, withTicketsModule)).unread).toBe(0);
  });

  it("names the Customer and the Order", async () => {
    await sync();
    const order = await feedback(1);
    await sync();

    const { notifications } = await listNotifications(db.sql, "crms", 20, withFeedbackModule);

    expect(notifications[0]).toMatchObject({ customerId: "c1", customerName: "Jane Doe", orderId: order, rating: 1, ticketId: null });
  });

  it("raises one alert per Feedback however many times it syncs", async () => {
    await sync();
    await feedback(2);
    await sync();
    await sync();

    expect(await alertsFor(withFeedbackModule)).toHaveLength(1);
  });

  it("ignores Feedback older than the sync window", async () => {
    await sync();
    await feedback(1, new Date(Date.now() - 30 * 86_400_000));

    expect(await sync()).toEqual({ baselined: false, created: 0 });
  });

  it("opens no Ticket", async () => {
    await sync();
    await feedback(1);
    await sync();

    const [{ count }] = await db.sql<{ count: number }[]>`select count(*)::int as count from tickets`;
    expect(count).toBe(0);
  });
});

describe("who the bell is for", () => {
  const staff = { username: "ada" };

  it("shows the Feedback alerts to Staff who may open the Feedback page", () => {
    expect(viewerFor(staff, ["/feedback"])).toEqual({ customerProfiles: false, ticketsStaffId: null, feedback: true, orders: false, payments: false });
  });

  it("gives Staff with only the Tickets Module no Feedback alerts", () => {
    expect(viewerFor(staff, ["/tickets", "/conversations"])).toMatchObject({ feedback: false });
  });

  it("shows nothing to Staff with none of the notification Modules", () => {
    expect(viewerFor(staff, [])).toBeNull();
  });
});
