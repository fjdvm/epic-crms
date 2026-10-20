import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getTicket, loadTicket } from "@/features/tickets/ticket";

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
  await db.sql`truncate ticket_messages, tickets, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, first_name, email)
    values ('c1', 'Maria Santos', 'Maria', 'maria@example.com')`;
});

async function order(
  options: { status?: string; subtotal?: number; deliveryFee?: number | null; daysAgo?: number; lines?: [string, number][] } = {},
) {
  const [row] = await db.sql<{ id: number }[]>`
    insert into orders (customer_id, status, subtotal_in_centavos, delivery_fee_in_centavos, created_at)
    values ('c1', ${options.status ?? "paid"}, ${options.subtotal ?? 100_000}, ${options.deliveryFee ?? null},
      ${new Date(NOW.getTime() - (options.daysAgo ?? 1) * 24 * 60 * 60 * 1000)})
    returning id`;

  for (const [product, quantity] of options.lines ?? []) {
    await db.sql`insert into order_lines (order_id, product_name, quantity) values (${row.id}, ${product}, ${quantity})`;
  }

  return row.id;
}

async function ticket(options: { orderId?: number; claimedBy?: string; status?: string; priority?: string } = {}) {
  const [row] = await db.sql<{ id: number }[]>`
    insert into tickets (customer_id, subject, order_id, status, priority, claimed_by_id, claimed_by_name, created_at)
    values ('c1', 'Halaya pouch arrived leaking', ${options.orderId ?? null}, ${options.status ?? "open"},
      ${options.priority ?? "high"}, ${options.claimedBy ? "staff-1" : null}, ${options.claimedBy ?? null}, ${hoursAgo(30)})
    returning id`;

  return row.id;
}

async function message(ticketId: number, sender: "customer" | "staff", body: string, hours: number, id?: string) {
  await db.sql`insert into ticket_messages (ticket_id, sender, body, file_id, created_at)
    values (${ticketId}, ${sender}, ${body}, ${id ?? null}, ${hoursAgo(hours)})`;
}

describe("the Ticket page data", () => {
  it("is null for a Ticket that does not exist", async () => {
    expect(await getTicket(db.sql, 999, NOW)).toBeNull();
  });

  it("carries the TKT number, subject, status, Priority, opened date and Claimer", async () => {
    const id = await ticket({ claimedBy: "Bernice" });

    const t = await getTicket(db.sql, id, NOW);

    expect(t).toMatchObject({
      id,
      subject: "Halaya pouch arrived leaking",
      status: "open",
      priority: "high",
      claimerName: "Bernice",
      openedAt: hoursAgo(30),
    });
  });

  it("has no Claimer on an Unclaimed Ticket", async () => {
    const id = await ticket();

    expect((await getTicket(db.sql, id, NOW))?.claimerName).toBeNull();
  });

  it("lists every Message oldest first with its sender, and names Staff after the Claimer", async () => {
    const id = await ticket({ claimedBy: "Bernice" });
    await message(id, "staff", "second", 3);
    await message(id, "customer", "first", 5);
    await message(id, "customer", "third", 1, "file-9");

    const t = await getTicket(db.sql, id, NOW);

    expect(t?.messages.map((m) => [m.sender, m.body, m.senderName, m.hasAttachment])).toEqual([
      ["customer", "first", "Maria", false],
      ["staff", "second", "Bernice", false],
      ["customer", "third", "Maria", true],
    ]);
    expect(t?.messages[0].createdAt).toEqual(hoursAgo(5));
  });

  it("calls Staff just Staff when nobody has Claimed the Ticket", async () => {
    const id = await ticket();
    await message(id, "staff", "hello", 2);

    expect((await getTicket(db.sql, id, NOW))?.messages[0].senderName).toBe("Staff");
  });

  it("has no Linked order when the Ticket has none", async () => {
    const id = await ticket();

    expect((await getTicket(db.sql, id, NOW))?.order).toBeNull();
  });

  it("shows the Linked order with its total, payment status, status and lines", async () => {
    const orderId = await order({
      status: "dispatched",
      subtotal: 95_000,
      deliveryFee: 5_700,
      lines: [["Smooth tub", 2], ["Powder", 1]],
    });
    const id = await ticket({ orderId });

    const t = await getTicket(db.sql, id, NOW);

    expect(t?.order).toEqual({
      id: orderId,
      total: 100_700,
      status: "dispatched",
      lines: [{ product: "Smooth tub", quantity: 2 }, { product: "Powder", quantity: 1 }],
    });
  });

  it("describes the Customer with Stage, order count and Total spent", async () => {
    await order({ status: "delivered", subtotal: 100_000, deliveryFee: 5_000, daysAgo: 30 });
    await order({ status: "paid", subtotal: 50_000, daysAgo: 3 });
    await order({ status: "placed", subtotal: 70_000, daysAgo: 2 });
    await order({ status: "cancelled", subtotal: 90_000, daysAgo: 1 });
    const id = await ticket();

    const t = await getTicket(db.sql, id, NOW);

    expect(t?.customer).toEqual({
      id: "c1",
      name: "Maria Santos",
      stage: "repeat",
      orders: 4,
      totalSpent: 155_000,
    });
  });

  it("gives a Customer with no Orders the New Stage", async () => {
    const id = await ticket();

    expect((await getTicket(db.sql, id, NOW))?.customer).toMatchObject({ stage: "new", orders: 0, totalSpent: 0 });
  });
});

describe("loading a Ticket for the page", () => {
  it("wraps a found Ticket", async () => {
    const id = await ticket();

    const result = await loadTicket(() => db.sql, id);

    expect(result.ok && result.ticket?.id).toBe(id);
  });

  it("reports an unreachable database instead of throwing", async () => {
    const result = await loadTicket(() => {
      throw new Error("down");
    }, 1);

    expect(result).toEqual({ ok: false });
  });
});
