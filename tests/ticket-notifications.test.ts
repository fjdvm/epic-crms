import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listNotifications, markAllRead, markRead, syncNewCustomers } from "@/features/notifications/notifications";
import { syncTicketEvents } from "@/features/notifications/ticket-events";

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
  await db.sql`truncate ticket_messages, tickets, customers restart identity cascade`;
  await db.sql`truncate crms.notifications, crms.seen_ticket_events, crms.ticket_sync_state, crms.seen_customers, crms.sync_state restart identity`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Jane Doe', 'jane@example.com')`;
});

// The reader and the writer are one connection here; production uses two roles on one database.
const sync = () => syncTicketEvents(db.sql, db.sql);

const everyone = { customerProfiles: false, ticketsStaffId: "ada" };
const ada = { customerProfiles: false, ticketsStaffId: "ada" };
const ben = { customerProfiles: false, ticketsStaffId: "ben" };
const noTicketsModule = { customerProfiles: true, ticketsStaffId: null };

async function alertsFor(viewer: { customerProfiles: boolean; ticketsStaffId: string | null }) {
  const feed = await listNotifications(db.sql, "crms", 20, viewer);

  return feed.notifications.map((n) => `${n.kind}:${n.ticketId}`).sort();
}

/** A Ticket the Customer raised, with its opening Message, or one Staff opened (Claimed by the opener). */
async function ticket(options: { staff?: boolean; claimedBy?: string; status?: string } = {}) {
  const [row] = await db.sql<{ id: number }[]>`
    insert into tickets (customer_id, subject, status, claimed_by_id, claimed_by_name)
    values ('c1', 'Where is my Order?', ${options.status ?? "open"},
      ${options.claimedBy ?? (options.staff ? "ada" : null)}, ${options.claimedBy ?? (options.staff ? "Ada" : null)})
    returning id`;

  await db.sql`insert into ticket_messages (ticket_id, sender, body)
    values (${row.id}, ${options.staff ? "staff" : "customer"}, 'first')`;

  return row.id;
}

const message = (ticketId: number, sender: "customer" | "staff") =>
  db.sql`insert into ticket_messages (ticket_id, sender, body) values (${ticketId}, ${sender}, 'hi')`;

describe("Ticket notifications", () => {
  it("raises nothing for Tickets and Messages that were there before the first sync", async () => {
    const id = await ticket();
    await message(id, "customer");

    const first = await sync();

    expect(first).toEqual({ baselined: true, created: 0 });
    expect(await alertsFor(ada)).toEqual([]);
  });

  describe("a new Ticket", () => {
    it("alerts every Staff member with the Tickets Module, and no one else", async () => {
      await sync();
      const id = await ticket();
      await sync();

      expect(await alertsFor(ada)).toEqual([`ticket-new:${id}`]);
      expect(await alertsFor(ben)).toEqual([`ticket-new:${id}`]);
      expect(await alertsFor(noTicketsModule)).toEqual([]);
    });

    it("raises one alert for a Ticket, not another for its opening Message", async () => {
      await sync();
      const id = await ticket();
      await sync();

      expect(await alertsFor(everyone)).toEqual([`ticket-new:${id}`]);
    });

    it("raises none for a Ticket Staff opened", async () => {
      await sync();
      await ticket({ staff: true });
      await sync();

      expect(await alertsFor(ada)).toEqual([]);
    });
  });

  describe("a new Customer Message", () => {
    it("alerts only the Claimer when the Ticket is Claimed", async () => {
      const id = await ticket({ claimedBy: "ada" });
      await sync();
      await message(id, "customer");
      await sync();

      expect(await alertsFor(ada)).toEqual([`ticket-message:${id}`]);
      expect(await alertsFor(ben)).toEqual([]);
      expect(await alertsFor(noTicketsModule)).toEqual([]);
    });

    it("alerts every Staff member with the Module while the Ticket is Unclaimed", async () => {
      const id = await ticket();
      await sync();
      await message(id, "customer");
      await sync();

      expect(await alertsFor(ada)).toEqual([`ticket-message:${id}`]);
      expect(await alertsFor(ben)).toEqual([`ticket-message:${id}`]);
      expect(await alertsFor(noTicketsModule)).toEqual([]);
    });

    it("raises none for a Staff Message", async () => {
      const id = await ticket({ claimedBy: "ada" });
      await sync();
      await message(id, "staff");
      await sync();

      expect(await alertsFor(ada)).toEqual([]);
    });

    it("alerts for a Customer reply on a Ticket Staff opened", async () => {
      const id = await ticket({ staff: true });
      await sync();
      await message(id, "customer");
      await sync();

      expect(await alertsFor(ada)).toEqual([`ticket-message:${id}`]);
      expect(await alertsFor(ben)).toEqual([]);
    });
  });

  describe("a Ticket the Customer says is not fixed", () => {
    async function resolved(claimedBy?: string) {
      const id = await ticket({ claimedBy, status: "resolved" });
      await db.sql`update tickets set resolved_at = now() where id = ${id}`;

      return id;
    }

    it("alerts only the Claimer", async () => {
      const id = await resolved("ada");
      await sync();
      await db.sql`update tickets set status = 'open' where id = ${id}`;
      await sync();

      expect(await alertsFor(ada)).toEqual([`ticket-not-fixed:${id}`]);
      expect(await alertsFor(ben)).toEqual([]);
    });

    it("alerts every Staff member with the Module while Unclaimed", async () => {
      const id = await resolved();
      await sync();
      await db.sql`update tickets set status = 'open' where id = ${id}`;
      await sync();

      expect(await alertsFor(ada)).toEqual([`ticket-not-fixed:${id}`]);
      expect(await alertsFor(ben)).toEqual([`ticket-not-fixed:${id}`]);
    });

    it("raises only the Message alert when a Customer Message reopened it", async () => {
      const id = await resolved("ada");
      await sync();
      await db.sql`update tickets set status = 'open' where id = ${id}`;
      await message(id, "customer");
      await sync();

      expect(await alertsFor(ada)).toEqual([`ticket-message:${id}`]);
    });

    it("alerts again when the Ticket is Resolved and found not fixed a second time", async () => {
      const id = await resolved("ada");
      await sync();
      await db.sql`update tickets set status = 'open' where id = ${id}`;
      await sync();
      await db.sql`update tickets set status = 'resolved', resolved_at = now() + interval '1 hour' where id = ${id}`;
      await db.sql`update tickets set status = 'open' where id = ${id}`;
      await sync();

      expect(await alertsFor(ada)).toHaveLength(2);
    });
  });

  it("raises no alert when the Customer completes a Ticket", async () => {
    const open = await ticket({ claimedBy: "ada" });
    const resolved = await ticket({ claimedBy: "ada", status: "resolved" });
    await db.sql`update tickets set resolved_at = now() where id = ${resolved}`;
    await sync();
    await db.sql`update tickets set status = 'completed' where id in (${open}, ${resolved})`;
    await sync();

    expect(await alertsFor(ada)).toEqual([]);
  });

  it("raises one alert per event however often, and however concurrently, it syncs", async () => {
    await sync();
    const id = await ticket();
    await message(id, "customer");

    await Promise.all([sync(), sync(), sync()]);
    await sync();

    expect(await alertsFor(ada)).toEqual([`ticket-message:${id}`, `ticket-new:${id}`]);
  });

  describe("alongside New Customer alerts", () => {
    it("keeps New Customer alerts one per Customer and visible by the Customer Profiles Module", async () => {
      await syncNewCustomers(db.sql, [{ id: "c1", name: "Jane Doe" }], "crms");
      await syncNewCustomers(db.sql, [{ id: "c1", name: "Jane Doe" }, { id: "c2", name: "Ben Cruz" }], "crms");
      await sync();
      await ticket();
      await sync();

      const profiles = { customerProfiles: true, ticketsStaffId: null };
      expect(await alertsFor(profiles)).toEqual(["new-customer:null"]);
      expect(await alertsFor(ada)).toHaveLength(1);
      expect(await alertsFor({ customerProfiles: true, ticketsStaffId: "ada" })).toHaveLength(2);
    });

    it("lets a Customer who is new also raise a Ticket alert", async () => {
      await syncNewCustomers(db.sql, [], "crms");
      await syncNewCustomers(db.sql, [{ id: "c1", name: "Jane Doe" }], "crms");
      await sync();
      await ticket();
      await sync();

      expect(await alertsFor({ customerProfiles: true, ticketsStaffId: "ada" })).toHaveLength(2);
    });
  });

  describe("reading", () => {
    it("counts unread only among the alerts the viewer can see", async () => {
      await sync();
      const mine = await ticket({ claimedBy: "ada" });
      await message(mine, "customer");
      await sync();

      expect((await listNotifications(db.sql, "crms", 20, ada)).unread).toBe(2);
      expect((await listNotifications(db.sql, "crms", 20, ben)).unread).toBe(1);
    });

    it("marks all read only for what the viewer can see", async () => {
      await syncNewCustomers(db.sql, [], "crms");
      await syncNewCustomers(db.sql, [{ id: "c9", name: "Zed" }], "crms");
      await sync();
      const id = await ticket({ claimedBy: "ada" });
      await message(id, "customer");
      await sync();

      await markAllRead(db.sql, "crms", ben);

      // Ben clears the alert addressed to everyone, but not Ada's own or the New Customer one.
      expect((await listNotifications(db.sql, "crms", 20, ada)).unread).toBe(1);
      expect((await listNotifications(db.sql, "crms", 20, { customerProfiles: true, ticketsStaffId: null })).unread).toBe(1);

      await markAllRead(db.sql, "crms", ada);
      expect((await listNotifications(db.sql, "crms", 20, ada)).unread).toBe(0);
    });

    it("will not mark read an alert the viewer cannot see", async () => {
      await sync();
      const id = await ticket({ claimedBy: "ada" });
      await message(id, "customer");
      await sync();
      const [theirs] = (await listNotifications(db.sql, "crms", 20, ada)).notifications;

      await markRead(db.sql, theirs.id, "crms", ben);
      expect((await listNotifications(db.sql, "crms", 20, ada)).unread).toBe(2);

      await markRead(db.sql, theirs.id, "crms", ada);
      expect((await listNotifications(db.sql, "crms", 20, ada)).unread).toBe(1);
    });
  });
});
