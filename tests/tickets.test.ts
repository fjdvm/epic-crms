import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listTicketFilterOptions, listTickets, loadTickets, UNCLAIMED } from "@/features/tickets/tickets";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

const NOW = new Date("2026-10-20T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values
    ('c1', 'Jane Doe', 'jane@example.com'), ('c2', 'Maria Santos', 'maria.s@shop.ph')`;
});

/** A Ticket with its Messages, oldest first, each as [sender, hours ago]. */
async function ticket(
  options: {
    subject?: string;
    status?: "open" | "resolved" | "completed";
    priority?: string;
    category?: string;
    customer?: string;
    claimedBy?: [string, string];
    orderId?: number;
    openedHoursAgo?: number;
    messages?: [("customer" | "staff"), number][];
  } = {},
) {
  const [row] = await db.sql<{ id: number }[]>`
    insert into tickets (customer_id, subject, status, priority, category, order_id, claimed_by_id,
      claimed_by_name, created_at)
    values (${options.customer ?? "c1"}, ${options.subject ?? "Where is my Order?"}, ${options.status ?? "open"},
      ${options.priority ?? "normal"}, ${options.category ?? "Other"}, ${options.orderId ?? null},
      ${options.claimedBy?.[0] ?? null}, ${options.claimedBy?.[1] ?? null}, ${hoursAgo(options.openedHoursAgo ?? 100)})
    returning id`;

  for (const [sender, hours] of options.messages ?? []) {
    await db.sql`insert into ticket_messages (ticket_id, sender, body, created_at)
      values (${row.id}, ${sender}, 'hello', ${hoursAgo(hours)})`;
  }

  return row.id;
}

const subjects = (rows: { subject: string }[]) => rows.map((r) => r.subject);

const BERNICE: [string, string] = ["staff-1", "Bernice"];
const RHEA: [string, string] = ["staff-2", "Rhea"];

describe("the Tickets list", () => {
  it("lists every Ticket, Claimed or not, with who Claimed it", async () => {
    await ticket({ subject: "free", messages: [["customer", 2]] });
    await ticket({ subject: "taken", claimedBy: RHEA, messages: [["customer", 3]] });

    const list = await listTickets(db.sql, { tab: "open", now: NOW });

    expect(list.rows.map((r) => [r.subject, r.claimedById, r.claimedByName])).toEqual([
      ["free", null, null],
      ["taken", "staff-2", "Rhea"],
    ]);
    expect(list.counts.open).toBe(2);
  });
});

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

  it("Resolved and Completed list their own Tickets, and All lists every one", async () => {
    await ticket({ subject: "open one", messages: [["customer", 1]] });
    await ticket({ subject: "resolved one", status: "resolved", messages: [["staff", 4]] });
    await ticket({ subject: "completed one", status: "completed", messages: [["staff", 9]] });

    const at = async (tab: "resolved" | "completed" | "all") =>
      subjects((await listTickets(db.sql, { tab, now: NOW })).rows);

    expect(await at("resolved")).toEqual(["resolved one"]);
    expect(await at("completed")).toEqual(["completed one"]);
    expect(await at("all")).toEqual(["open one", "resolved one", "completed one"]);
  });

  it("Mine lists only the viewer's Claimed Tickets, of any status", async () => {
    await ticket({ subject: "mine open", claimedBy: BERNICE, messages: [["customer", 1]] });
    await ticket({ subject: "mine done", claimedBy: BERNICE, status: "resolved", messages: [["staff", 2]] });
    await ticket({ subject: "hers", claimedBy: RHEA, messages: [["customer", 1]] });
    await ticket({ subject: "nobody's", messages: [["customer", 1]] });

    const list = await listTickets(db.sql, { tab: "mine", viewerId: "staff-1", now: NOW });

    expect(subjects(list.rows).sort()).toEqual(["mine done", "mine open"]);
    expect(list.counts.mine).toBe(2);
  });

  it("counts each tab and reports open and Overdue totals regardless of the tab shown", async () => {
    await ticket({ messages: [["customer", 30]] });
    await ticket({ messages: [["customer", 2]] });
    await ticket({ messages: [["customer", 40], ["staff", 30]] });
    await ticket({ status: "resolved", messages: [["staff", 1]] });
    await ticket({ status: "completed", messages: [["staff", 1]] });

    const list = await listTickets(db.sql, { tab: "resolved", now: NOW });

    expect(list.counts).toMatchObject({ open: 3, waiting: 1, resolved: 1, completed: 1, all: 5 });
    expect(list.totalOpen).toBe(3);
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

    const list = await listTickets(db.sql, { tab: "all", now: NOW });

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

describe("searching the Tickets list", () => {
  it("finds a Ticket by number, as TKT-<n> or plain", async () => {
    const id = await ticket({ subject: "target", messages: [["customer", 1]] });
    await ticket({ subject: "other", messages: [["customer", 1]] });

    for (const q of [`TKT-${id}`, `tkt${id}`, String(id)]) {
      expect(subjects((await listTickets(db.sql, { tab: "all", q, now: NOW })).rows), q).toEqual(["target"]);
    }
  });

  it("finds a Ticket by Customer name or email, in any case and in part", async () => {
    await ticket({ subject: "jane's", customer: "c1" });
    await ticket({ subject: "maria's", customer: "c2" });

    const by = async (q: string) => subjects((await listTickets(db.sql, { tab: "all", q, now: NOW })).rows);

    expect(await by("maria")).toEqual(["maria's"]);
    expect(await by("JANE DOE")).toEqual(["jane's"]);
    expect(await by("shop.ph")).toEqual(["maria's"]);
  });

  it("finds a Ticket by Linked order, as #<n> or plain", async () => {
    const [order] = await db.sql<{ id: number }[]>`insert into orders (customer_id) values ('c1') returning id`;
    await ticket({ subject: "about the order", orderId: order.id });
    await ticket({ subject: "about nothing" });

    for (const q of [`#${order.id}`, String(order.id)]) {
      expect(subjects((await listTickets(db.sql, { tab: "all", q, now: NOW })).rows), q).toEqual(["about the order"]);
    }
  });

  it("treats % and _ as plain characters", async () => {
    await ticket({ subject: "anything" });

    expect((await listTickets(db.sql, { tab: "all", q: "%", now: NOW })).rows).toEqual([]);
    expect((await listTickets(db.sql, { tab: "all", q: "j_ne", now: NOW })).rows).toEqual([]);
  });

  it("narrows the tab counts too, so every tab shows its matches", async () => {
    await ticket({ subject: "jane open", customer: "c1", messages: [["customer", 1]] });
    await ticket({ subject: "maria open", customer: "c2", messages: [["customer", 1]] });
    await ticket({ subject: "maria done", customer: "c2", status: "resolved" });

    const list = await listTickets(db.sql, { tab: "open", q: "maria", now: NOW });

    expect(list.counts).toMatchObject({ open: 1, resolved: 1, all: 2 });
    expect(list.totalOpen).toBe(2);
  });
});

describe("filtering the Tickets list", () => {
  beforeEach(async () => {
    await ticket({ subject: "a", priority: "high", category: "Damaged item", claimedBy: RHEA, messages: [["customer", 30]] });
    await ticket({ subject: "b", priority: "high", category: "Delivery", messages: [["customer", 30]] });
    await ticket({ subject: "c", priority: "low", category: "Damaged item", messages: [["customer", 2]] });
    await ticket({ subject: "d", priority: "high", category: "Damaged item", claimedBy: BERNICE, messages: [["customer", 2]] });
  });

  const find = async (query: Parameters<typeof listTickets>[1]) =>
    subjects((await listTickets(db.sql, { tab: "all", now: NOW, ...query })).rows).sort();

  it("by Priority", async () => {
    expect(await find({ priority: "high" })).toEqual(["a", "b", "d"]);
  });

  it("by Category", async () => {
    expect(await find({ category: "Damaged item" })).toEqual(["a", "c", "d"]);
  });

  it("by Claimed by, including Unclaimed", async () => {
    expect(await find({ claimedBy: "staff-2" })).toEqual(["a"]);
    expect(await find({ claimedBy: UNCLAIMED })).toEqual(["b", "c"]);
  });

  it("to Overdue Tickets, Claimed or not", async () => {
    expect(await find({ overdue: true })).toEqual(["a", "b"]);
  });

  it("alone or together, with a search", async () => {
    expect(await find({ priority: "high", category: "Damaged item" })).toEqual(["a", "d"]);
    expect(await find({ priority: "high", category: "Damaged item", claimedBy: UNCLAIMED })).toEqual([]);
    expect(await find({ priority: "high", overdue: true, claimedBy: UNCLAIMED })).toEqual(["b"]);
    expect(await find({ q: "jane", category: "Delivery", overdue: true })).toEqual(["b"]);
  });

  it("applies to the tab counts, and Overdue shows only Open Tickets", async () => {
    const list = await listTickets(db.sql, { tab: "open", now: NOW, overdue: true, priority: "high" });

    expect(list.counts).toMatchObject({ open: 2, all: 2 });
  });

  it("offers the Categories Tickets have and everyone who Claimed one", async () => {
    expect(await listTicketFilterOptions(db.sql)).toEqual({
      categories: ["Damaged item", "Delivery"],
      claimers: [
        { id: "staff-1", name: "Bernice" },
        { id: "staff-2", name: "Rhea" },
      ],
    });
  });
});

describe("Ticket status as shown", () => {
  it("marks a Ticket waiting on the Customer the same way on the Open tab", async () => {
    await ticket({ messages: [["customer", 5], ["staff", 3]] });

    expect((await listTickets(db.sql, { tab: "open", now: NOW })).rows[0].waiting).toBe(true);
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
