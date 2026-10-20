import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listTickets, loadTickets } from "@/features/tickets/tickets";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

const NOW = new Date("2026-10-20T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

beforeAll(async () => {
  db = await startTestDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Jane Doe', 'jane@example.com')`;
});

/** A Ticket with its Messages, oldest first, each as [sender, hours ago]. */
async function ticket(
  options: {
    subject?: string;
    status?: "open" | "resolved" | "completed";
    priority?: string;
    orderId?: number;
    openedHoursAgo?: number;
    messages?: [("customer" | "staff"), number][];
  } = {},
) {
  const [row] = await db.sql<{ id: number }[]>`
    insert into tickets (customer_id, subject, status, priority, order_id, created_at)
    values ('c1', ${options.subject ?? "Where is my Order?"}, ${options.status ?? "open"},
      ${options.priority ?? "normal"}, ${options.orderId ?? null}, ${hoursAgo(options.openedHoursAgo ?? 100)})
    returning id`;

  for (const [sender, hours] of options.messages ?? []) {
    await db.sql`insert into ticket_messages (ticket_id, sender, body, created_at)
      values (${row.id}, ${sender}, 'hello', ${hoursAgo(hours)})`;
  }

  return row.id;
}

const subjects = (rows: { subject: string }[]) => rows.map((r) => r.subject);

describe("the Tickets list tabs", () => {
  it("Open lists every Open Ticket, including those waiting on the Customer", async () => {
    await ticket({ subject: "unanswered", messages: [["customer", 2]] });
    await ticket({ subject: "answered", messages: [["customer", 5], ["staff", 3]] });
    await ticket({ subject: "done", status: "resolved", messages: [["customer", 5]] });

    const list = await listTickets(db.sql, { tab: "open", now: NOW });

    expect(subjects(list.rows).sort()).toEqual(["answered", "unanswered"]);
  });

  it("Waiting on customer lists Open Tickets whose last Message came from Staff", async () => {
    await ticket({ subject: "unanswered", messages: [["customer", 2]] });
    await ticket({ subject: "answered", messages: [["customer", 5], ["staff", 3]] });
    await ticket({ subject: "customer again", messages: [["staff", 6], ["customer", 1]] });
    await ticket({ subject: "resolved by staff", status: "resolved", messages: [["staff", 3]] });

    const list = await listTickets(db.sql, { tab: "waiting", now: NOW });

    expect(subjects(list.rows)).toEqual(["answered"]);
  });

  it("Resolved lists Resolved and Completed Tickets", async () => {
    await ticket({ subject: "open one", messages: [["customer", 1]] });
    await ticket({ subject: "resolved one", status: "resolved", messages: [["staff", 4]] });
    await ticket({ subject: "completed one", status: "completed", messages: [["staff", 9]] });

    const list = await listTickets(db.sql, { tab: "resolved", now: NOW });

    expect(list.rows.map((r) => [r.subject, r.status])).toEqual([
      ["resolved one", "resolved"],
      ["completed one", "completed"],
    ]);
  });

  it("counts each tab and reports open and Overdue totals regardless of the tab shown", async () => {
    await ticket({ messages: [["customer", 30]] });
    await ticket({ messages: [["customer", 2]] });
    await ticket({ messages: [["customer", 40], ["staff", 30]] });
    await ticket({ status: "resolved", messages: [["staff", 1]] });
    await ticket({ status: "completed", messages: [["staff", 1]] });

    const list = await listTickets(db.sql, { tab: "resolved", now: NOW });

    expect(list.counts).toEqual({ open: 3, waiting: 1, resolved: 2 });
    expect(list.overdue).toBe(1);
  });
});

describe("Overdue", () => {
  const overdueOf = async (id: number) =>
    (await listTickets(db.sql, { tab: "open", now: NOW })).rows.find((r) => r.id === id)?.overdue;

  it("is an Open Ticket whose Customer Message has gone more than 24 hours without a Staff reply", async () => {
    expect(await overdueOf(await ticket({ messages: [["customer", 24.5]] }))).toBe(true);
    expect(await overdueOf(await ticket({ messages: [["customer", 23.5]] }))).toBe(false);
  });

  it("counts a brand-new Ticket nobody has answered", async () => {
    expect(await overdueOf(await ticket({ openedHoursAgo: 30, messages: [["customer", 30]] }))).toBe(true);
  });

  it("counts a Ticket with no Messages from when it was opened", async () => {
    expect(await overdueOf(await ticket({ openedHoursAgo: 30 }))).toBe(true);
  });

  it("is never true while waiting on the Customer, however long ago Staff replied", async () => {
    expect(await overdueOf(await ticket({ messages: [["customer", 90], ["staff", 80]] }))).toBe(false);
  });

  it("is never true for a Resolved or Completed Ticket", async () => {
    await ticket({ status: "resolved", messages: [["customer", 90]] });
    await ticket({ status: "completed", messages: [["customer", 90]] });

    const list = await listTickets(db.sql, { tab: "resolved", now: NOW });

    expect(list.rows.map((r) => r.overdue)).toEqual([false, false]);
    expect(list.overdue).toBe(0);
  });
});

describe("Ticket rows", () => {
  it("show the Ticket number, subject, Customer, Linked order and Priority", async () => {
    const [order] = await db.sql<{ id: number }[]>`insert into orders (customer_id) values ('c1') returning id`;
    const id = await ticket({ subject: "Cracked bottle", priority: "high", orderId: order.id, messages: [["customer", 1]] });

    const [row] = (await listTickets(db.sql, { tab: "open", now: NOW })).rows;

    expect(row).toMatchObject({
      id,
      subject: "Cracked bottle",
      customerName: "Jane Doe",
      orderId: order.id,
      priority: "high",
      status: "open",
    });
  });

  it("have no Linked order when none was chosen", async () => {
    await ticket({ messages: [["customer", 1]] });

    expect((await listTickets(db.sql, { tab: "open", now: NOW })).rows[0].orderId).toBeNull();
  });

  it("come newest activity first, by last Message", async () => {
    await ticket({ subject: "old", openedHoursAgo: 200, messages: [["customer", 100]] });
    await ticket({ subject: "recent", openedHoursAgo: 300, messages: [["customer", 100], ["customer", 1]] });
    await ticket({ subject: "middle", openedHoursAgo: 50, messages: [["customer", 10]] });

    const list = await listTickets(db.sql, { tab: "open", now: NOW });

    expect(subjects(list.rows)).toEqual(["recent", "middle", "old"]);
  });

  it("page 25 to a page", async () => {
    for (let i = 1; i <= 27; i++) await ticket({ subject: `t${i}`, messages: [["customer", i]] });

    const first = await listTickets(db.sql, { tab: "open", now: NOW });
    const second = await listTickets(db.sql, { tab: "open", page: 2, now: NOW });

    expect(first.rows).toHaveLength(25);
    expect(second.rows).toHaveLength(2);
    expect(first.totalPages).toBe(2);
    expect(second.page).toBe(2);
  });
});

describe("loadTickets", () => {
  it("says so instead of throwing when the database cannot be read", async () => {
    const result = await loadTickets(() => {
      throw new Error("no database");
    }, { tab: "open" });

    expect(result).toEqual({ ok: false });
  });
});
