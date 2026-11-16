import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listConversations } from "@/features/tickets/conversations";
import { getTicket } from "@/features/tickets/ticket";
import { addInternalNote, replyToTicket, type Actor } from "@/features/tickets/ticket-actions";
import { listTickets } from "@/features/tickets/tickets";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

const bernice: Actor = { id: "bernice", name: "Bernice" };
const carlo: Actor = { id: "carlo", name: "Carlo" };
// 30 hours after the Customer wrote: past the 24-hour first reply target.
const NOW = new Date("2026-10-02T06:00:00Z");

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, first_name, email) values ('c1', 'Maria Santos', 'Maria', 'maria@example.com')`;
});

async function ticket(status = "open") {
  const [row] = await db.sql<{ id: number }[]>`
    insert into tickets (customer_id, subject, status, claimed_by_id, claimed_by_name, created_at)
    values ('c1', 'Where is my cake?', ${status}, 'bernice', 'Bernice', ${new Date("2026-10-01T00:00:00Z")}) returning id`;
  await db.sql`insert into ticket_messages (ticket_id, sender, body, created_at) values (${row.id}, 'customer', 'Help', ${new Date("2026-10-01T00:00:00Z")})`;
  return row.id;
}

describe("Internal notes", () => {
  it("lets any Staff member, claimer or not, write a text-only note, labelled with the writer", async () => {
    const id = await ticket();

    const saved = await addInternalNote(db.sql, id, carlo, "  Courier says Tuesday  ");
    expect(saved).toMatchObject({ ok: true });

    const [row] = await db.sql`select sender, body, internal, author_name, file_id from ticket_messages where internal`;
    expect(row).toMatchObject({ sender: "staff", body: "Courier says Tuesday", internal: true, author_name: "Carlo", file_id: null });

    const notes = (await getTicket(db.sql, id, NOW))!.messages.filter((m) => m.internal);
    expect(notes).toMatchObject([{ body: "Courier says Tuesday", senderName: "Carlo", sender: "staff" }]);
  });

  it("refuses an empty or over-long note and a missing Ticket", async () => {
    const id = await ticket();

    expect(await addInternalNote(db.sql, id, carlo, "   ")).toEqual({ ok: false, reason: "note-empty" });
    expect(await addInternalNote(db.sql, id, carlo, "x".repeat(2001))).toEqual({ ok: false, reason: "internal-note-too-long" });
    expect(await addInternalNote(db.sql, 999, carlo, "hi")).toEqual({ ok: false, reason: "not-found" });
  });

  it("does not clear Overdue and is not the last word in the list or the Conversations preview", async () => {
    const id = await ticket();
    await addInternalNote(db.sql, id, bernice, "Looking into it");

    const detail = (await getTicket(db.sql, id, NOW))!;
    expect(detail.serviceLevel.firstReply.state).toBe("missed");
    expect(detail.serviceLevel.firstReply.state).not.toBe("met");

    const list = await listTickets(db.sql, { tab: "open", now: NOW });
    expect(list.rows[0]).toMatchObject({ overdue: true, waiting: false });

    const chats = await listConversations(db.sql, "bernice");
    expect(chats[0].preview).toBe("Help");
  });

  it("a real Staff reply still clears Overdue", async () => {
    const id = await ticket();
    await addInternalNote(db.sql, id, bernice, "note");
    await replyToTicket(db.sql, id, bernice, "On it");

    const list = await listTickets(db.sql, { tab: "all", now: NOW });
    expect(list.rows.find((r) => r.id === id)).toMatchObject({ overdue: false });
  });

  it("works on an unclaimed or Completed Ticket", async () => {
    const id = await ticket("completed");

    expect(await addInternalNote(db.sql, id, carlo, "For the record")).toMatchObject({ ok: true });
  });

  it("claiming is not needed and does not change the Claimer", async () => {
    const id = await ticket();
    await addInternalNote(db.sql, id, carlo, "hi");
    expect((await getTicket(db.sql, id, NOW))!.claimerId).toBe("bernice");
  });
});
