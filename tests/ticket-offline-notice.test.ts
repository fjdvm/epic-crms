import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { notifyOfflineCustomer } from "@/features/tickets/live";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, order_lines, orders, customers restart identity cascade`;
});

describe("offline Notification", () => {
  const bernice = { id: "bernice", name: "Bernice" };
  const url = (id: number) => `https://shop.test/support/${id}`;

  async function ticket(claimedBy: string | null) {
    await db.sql`insert into customers (id, full_name, first_name, email) values ('c1', 'Maria Santos', 'Maria', 'm@x.test')`;
    const [t] = await db.sql<{ id: number }[]>`
      insert into tickets (customer_id, subject, claimed_by_id) values ('c1', 'Leaking pouch', ${claimedBy}) returning id`;

    return t.id;
  }

  it("sends the Customer a storefront Notification linking to the Ticket", async () => {
    const id = await ticket("bernice");
    const send = vi.fn();

    expect(await notifyOfflineCustomer(db.sql, id, bernice, url, send)).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith({
      title: `New reply on TKT-${id}`,
      body: 'Bernice replied to "Leaking pouch".',
      link: url(id),
      userIds: ["c1"],
    });
  });

  it("refuses anyone but the Claimer", async () => {
    const id = await ticket("carlo");
    const send = vi.fn();

    expect(await notifyOfflineCustomer(db.sql, id, bernice, url, send)).toEqual({
      ok: false,
      reason: "not-claimer",
    });
    expect(send).not.toHaveBeenCalled();
  });
});
