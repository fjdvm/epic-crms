import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { inboxTime, listConversations, loadConversations } from "@/features/tickets/conversations";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

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
) {
  const [row] = await db.sql<{ id: number }[]>`
    insert into tickets (customer_id, subject, created_at)
    values (${customer}, ${subject}, ${minutesAgo(openedMinutesAgo)}) returning id`;

  for (const m of messages) {
    await db.sql`insert into ticket_messages (ticket_id, sender, body, file_id, created_at)
      values (${row.id}, 'customer', ${m.body}, ${m.file ? "f1" : null}, ${minutesAgo(m.minutes)})`;
  }

  return row.id;
}

describe("the Conversations list", () => {
  it("lists every chat with Customer name, last Message preview, time and Ticket number, newest activity first", async () => {
    const older = await chat("c2", "Receipt", [{ body: "first", minutes: 300 }, { body: "My receipt was rejected", minutes: 180 }]);
    const newer = await chat("c1", "Leak", [{ body: "Replacement please", minutes: 5 }]);

    const rows = await listConversations(db.sql);

    expect(rows.map((r) => [r.ticketId, r.customerName, r.preview])).toEqual([
      [newer, "Maria Santos", "Replacement please"],
      [older, "Ana Reyes", "My receipt was rejected"],
    ]);
    expect(rows[0].lastActivity).toEqual(minutesAgo(5));
  });

  it("includes Resolved and Completed Tickets' chats", async () => {
    const id = await chat("c1", "Done", [{ body: "thanks", minutes: 5 }]);
    await db.sql`update tickets set status = 'completed' where id = ${id}`;

    expect((await listConversations(db.sql)).map((r) => r.ticketId)).toEqual([id]);
  });

  it("previews an image alone as a photo, and a Ticket with no Message by its subject", async () => {
    const photo = await chat("c1", "Leak", [{ body: "", minutes: 5, file: true }]);
    const empty = await chat("c2", "Where is my order?", [], 60);

    const rows = await listConversations(db.sql);

    expect(rows.find((r) => r.ticketId === photo)?.preview).toBe("Sent a photo");
    expect(rows.find((r) => r.ticketId === empty)?.preview).toBe("Where is my order?");
    expect(rows.find((r) => r.ticketId === empty)?.lastActivity).toEqual(minutesAgo(60));
  });
});

describe("the open chat", () => {
  it("is the one asked for, with its Messages", async () => {
    await chat("c1", "Leak", [{ body: "hello", minutes: 5 }]);
    const asked = await chat("c2", "Receipt", [{ body: "my receipt", minutes: 50 }]);

    const result = await loadConversations(() => db.sql, asked);

    expect(result.ok && result.conversations.selected?.id).toBe(asked);
    expect(result.ok && result.conversations.selected?.messages.map((m) => m.body)).toEqual(["my receipt"]);
  });

  it("is the newest chat when none, or an unknown one, is asked for", async () => {
    await chat("c2", "Receipt", [{ body: "old", minutes: 50 }]);
    const newest = await chat("c1", "Leak", [{ body: "new", minutes: 5 }]);

    for (const asked of [undefined, 9999]) {
      const result = await loadConversations(() => db.sql, asked);
      expect(result.ok && result.conversations.selected?.id).toBe(newest);
    }
  });

  it("is nothing when there are no chats", async () => {
    const result = await loadConversations(() => db.sql);

    expect(result).toEqual({ ok: true, conversations: { chats: [], selected: null } });
  });

  it("reports an unreachable database instead of throwing", async () => {
    const result = await loadConversations(() => {
      throw new Error("down");
    });

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
