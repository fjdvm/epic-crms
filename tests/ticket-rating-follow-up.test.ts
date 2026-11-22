import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getTicket } from "@/features/tickets/ticket";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const NOW = new Date("2026-10-20T12:00:00Z");

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

async function ticket(subject: string, extra: { status?: string; followUpOf?: number; rating?: number; comment?: string; rated?: boolean } = {}) {
  const [row] = await db.sql<{ id: number }[]>`
    insert into tickets (customer_id, subject, status, follow_up_of_id, rating, rating_comment, rated_at)
    values ('c1', ${subject}, ${extra.status ?? "open"}, ${extra.followUpOf ?? null}, ${extra.rating ?? null}, ${extra.comment ?? null},
      ${extra.rated || extra.rating || extra.comment ? NOW : null})
    returning id`;

  return row.id;
}

describe("Customer rating on the Ticket page", () => {
  it("shows stars and comment when the Customer rated", async () => {
    const id = await ticket("Leaking pouch", { status: "completed", rating: 4, comment: "Quick help" });

    expect((await getTicket(db.sql, id, NOW))?.rating).toEqual({ stars: 4, comment: "Quick help", at: NOW });
  });

  it("is empty when the Customer skipped it", async () => {
    const id = await ticket("Leaking pouch", { status: "completed" });

    expect((await getTicket(db.sql, id, NOW))?.rating).toBeNull();
  });
});

describe("Follow-up links", () => {
  it("shows the earlier Ticket on the Follow-up and the Follow-up on the earlier Ticket, which stays Completed", async () => {
    const earlier = await ticket("Leaking pouch", { status: "completed" });
    const later = await ticket("Still no refund", { followUpOf: earlier });

    const follow = await getTicket(db.sql, later, NOW);
    const original = await getTicket(db.sql, earlier, NOW);

    expect(follow?.followUpOf).toEqual({ id: earlier, subject: "Leaking pouch", status: "completed" });
    expect(follow?.followUps).toEqual([]);
    expect(original?.followUps).toEqual([{ id: later, subject: "Still no refund", status: "open" }]);
    expect(original?.followUpOf).toBeNull();
    expect(original?.status).toBe("completed");
  });

  it("has no related Tickets for an ordinary Ticket", async () => {
    const id = await ticket("Plain");
    const detail = await getTicket(db.sql, id, NOW);

    expect(detail?.followUpOf).toBeNull();
    expect(detail?.followUps).toEqual([]);
  });
});
