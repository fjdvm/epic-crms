import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { allowedScope, inboxTime, scopesFor, listConversations, loadConversations } from "@/features/tickets/conversations";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

const ME = "staff-1";
const NOW = new Date("2026-10-20T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values
    ('c1', 'Maria Santos', 'maria@example.com'), ('c2', 'Ana Reyes', 'ana@example.com')`;
});

async function chat(
  customer: string,
  subject: string,
  messages: { body: string; minutes: number; file?: boolean }[],
  openedMinutesAgo = 1_000,
  claimedBy: string | null = ME,
) {
  const [row] = await db.sql<{ id: number }[]>`
    insert into tickets (customer_id, subject, created_at, claimed_by_id)
    values (${customer}, ${subject}, ${minutesAgo(openedMinutesAgo)}, ${claimedBy}) returning id`;

  for (const m of messages) {
    await db.sql`insert into ticket_messages (ticket_id, sender, body, file_id, created_at)
      values (${row.id}, 'customer', ${m.body}, ${m.file ? "f1" : null}, ${minutesAgo(m.minutes)})`;
  }

  return row.id;
}

describe("the inbox tabs", () => {
  it("shows the viewer's chats on Mine, nobody's on Unclaimed and every chat on All", async () => {
    const mine = await chat("c1", "Leak", [{ body: "hi", minutes: 5 }]);
    const open = await chat("c2", "Receipt", [{ body: "hi", minutes: 6 }], 1_000, null);
    const theirs = await chat("c2", "Late", [{ body: "hi", minutes: 7 }], 1_000, "staff-2");
    const ids = async (scope: "mine" | "unclaimed" | "all") =>
      (await listConversations(db.sql, ME, undefined, scope)).map((r) => r.ticketId);

    expect(await ids("mine")).toEqual([mine]);
    expect(await ids("unclaimed")).toEqual([open]);
    expect(await ids("all")).toEqual([mine, open, theirs]);
  });
});

describe("who may open which tab", () => {
  it("gives Staff Mine and Unclaimed, Managers all three, Admin and CEO Unclaimed and All", () => {
    expect(scopesFor("staff")).toEqual(["mine", "unclaimed"]);
    expect(scopesFor("manager")).toEqual(["mine", "unclaimed", "all"]);
    expect(scopesFor("admin")).toEqual(["unclaimed", "all"]);
    expect(scopesFor("ceo")).toEqual(["unclaimed", "all"]);
    expect(scopesFor(null)).toEqual(["unclaimed"]);
  });

  it("never lets an address open a tab the Role has no access to", () => {
    expect(allowedScope("staff", "all")).toBe("mine");
    expect(allowedScope("admin", "mine")).toBe("unclaimed");
    expect(allowedScope("admin", undefined)).toBe("unclaimed");
    expect(allowedScope("manager", "all")).toBe("all");
    expect(allowedScope("staff", "nonsense")).toBe("mine");
  });
});

describe("searching Conversations", () => {
  it("narrows the viewer's chats by Ticket number, Customer name or email, or Linked order", async () => {
    const [order] = await db.sql<{ id: number }[]>`insert into orders (customer_id) values ('c2') returning id`;
    const maria = await chat("c1", "Leak", [{ body: "hi", minutes: 5 }]);
    const ana = await chat("c2", "Receipt", [{ body: "hi", minutes: 6 }]);
    await db.sql`update tickets set order_id = ${order.id} where id = ${ana}`;

    const ids = async (q: string) => (await listConversations(db.sql, ME, q)).map((r) => r.ticketId);

    expect(await ids("maria")).toEqual([maria]);
    expect(await ids("ana@example")).toEqual([ana]);
    expect(await ids(`TKT-${maria}`)).toEqual([maria]);
    expect(await ids(`#${order.id}`)).toEqual([ana]);
    expect(await ids("")).toEqual([maria, ana]);
    expect(await ids("nobody")).toEqual([]);
  });

  it("still shows only the viewer's own Claimed Tickets", async () => {
    const mine = await chat("c1", "Mine", [{ body: "hi", minutes: 5 }]);
    await chat("c1", "Hers", [{ body: "hi", minutes: 6 }], 1_000, "staff-2");
    await chat("c1", "Unclaimed", [{ body: "hi", minutes: 7 }], 1_000, null);

    expect((await listConversations(db.sql, ME, "maria")).map((r) => r.ticketId)).toEqual([mine]);
  });

  it("opens the first match when the open chat does not match", async () => {
    const maria = await chat("c1", "Leak", [{ body: "hi", minutes: 5 }]);
    const ana = await chat("c2", "Receipt", [{ body: "hi", minutes: 6 }]);

    const result = await loadConversations(() => db.sql, ME, maria, undefined, "ana");

    expect(result.ok && result.conversations.selected?.id).toBe(ana);
  });
});

describe("the Conversations list", () => {
  it("lists every chat with Customer name, last Message preview, time and Ticket number, newest activity first", async () => {
    const older = await chat("c2", "Receipt", [{ body: "first", minutes: 300 }, { body: "My receipt was rejected", minutes: 180 }]);
    const newer = await chat("c1", "Leak", [{ body: "Replacement please", minutes: 5 }]);

    const rows = await listConversations(db.sql, ME);

    expect(rows.map((r) => [r.ticketId, r.customerName, r.preview])).toEqual([
      [newer, "Maria Santos", "Replacement please"],
      [older, "Ana Reyes", "My receipt was rejected"],
    ]);
    expect(rows[0].lastActivity).toEqual(minutesAgo(5));
  });

  it("lists only the Tickets this Staff member Claimed", async () => {
    const mine = await chat("c1", "Mine", [{ body: "hi", minutes: 5 }]);
    await chat("c2", "Theirs", [{ body: "hi", minutes: 5 }], 1_000, "staff-2");
    await chat("c2", "Nobody's", [{ body: "hi", minutes: 5 }], 1_000, null);

    expect((await listConversations(db.sql, ME)).map((r) => r.ticketId)).toEqual([mine]);
  });

  it("keeps Resolved and Completed Tickets' chats off Mine and Unclaimed, and on All only", async () => {
    const live = await chat("c1", "Live", [{ body: "hi", minutes: 5 }]);
    const done = await chat("c1", "Done", [{ body: "thanks", minutes: 6 }]);
    const resolved = await chat("c2", "Fixed", [{ body: "ok", minutes: 7 }], 1_000, null);
    await db.sql`update tickets set status = 'completed' where id = ${done}`;
    await db.sql`update tickets set status = 'resolved' where id = ${resolved}`;
    const ids = async (scope: "mine" | "unclaimed" | "all") =>
      (await listConversations(db.sql, ME, undefined, scope)).map((r) => r.ticketId);

    expect(await ids("mine")).toEqual([live]);
    expect(await ids("unclaimed")).toEqual([]);
    expect(await ids("all")).toEqual([live, done, resolved]);
  });

  it("previews an image alone as a photo, and a Ticket with no Message by its subject", async () => {
    const photo = await chat("c1", "Leak", [{ body: "", minutes: 5, file: true }]);
    const empty = await chat("c2", "Where is my order?", [], 60);

    const rows = await listConversations(db.sql, ME);

    expect(rows.find((r) => r.ticketId === photo)?.preview).toBe("Sent a photo");
    expect(rows.find((r) => r.ticketId === empty)?.preview).toBe("Where is my order?");
    expect(rows.find((r) => r.ticketId === empty)?.lastActivity).toEqual(minutesAgo(60));
  });
});

describe("the open chat", () => {
  it("is the one asked for, with its Messages", async () => {
    await chat("c1", "Leak", [{ body: "hello", minutes: 5 }]);
    const asked = await chat("c2", "Receipt", [{ body: "my receipt", minutes: 50 }]);

    const result = await loadConversations(() => db.sql, ME, asked);

    expect(result.ok && result.conversations.selected?.id).toBe(asked);
    expect(result.ok && result.conversations.selected?.messages.map((m) => m.body)).toEqual(["my receipt"]);
  });

  it("is the newest chat when none, or an unknown one, is asked for", async () => {
    await chat("c2", "Receipt", [{ body: "old", minutes: 50 }]);
    const newest = await chat("c1", "Leak", [{ body: "new", minutes: 5 }]);

    for (const asked of [undefined, 9999]) {
      const result = await loadConversations(() => db.sql, ME, asked);
      expect(result.ok && result.conversations.selected?.id).toBe(newest);
    }
  });

  it("is nothing when there are no chats", async () => {
    const result = await loadConversations(() => db.sql, ME);

    expect(result).toEqual({ ok: true, conversations: { chats: [], selected: null } });
  });

  it("reports an unreachable database instead of throwing", async () => {
    const result = await loadConversations(() => {
      throw new Error("down");
    }, ME);

    expect(result).toEqual({ ok: false });
  });
});

describe("inboxTime", () => {
  it.each([
    [0, "now"],
    [5, "5m"],
    [180, "3h"],
    [26 * 60, "Yesterday"],
    [72 * 60, "17 Oct 2026"],
  ])("shows %i minutes ago as %s", (minutes, shown) => {
    expect(inboxTime(minutesAgo(minutes), NOW)).toBe(shown);
  });
});
