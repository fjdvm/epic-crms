import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { customerOrders, openTicket, searchCustomers, type NewTicketInput } from "@/features/tickets/new-ticket";
import type { Actor } from "@/features/tickets/ticket-actions";

import { FakeFileStorage, PDF, PNG } from "./fake-file-storage";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const storage = new FakeFileStorage();
const bernice: Actor = { id: "bernice", name: "Bernice" };
const sent: Parameters<Parameters<typeof openTicket>[4]["sendEmail"]>[0][] = [];

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  storage.reset();
  sent.length = 0;
  await db.sql`truncate ticket_messages, tickets, order_lines, orders, customers, neon_auth."user" restart identity cascade`;
  await db.sql`insert into customers (id, full_name, first_name, email) values
    ('c1', 'Maria Santos', 'Maria', 'maria@example.com'),
    ('c2', 'Mark Tan', 'Mark', 'mark@example.com'),
    ('lead', 'Marco Lead', 'Marco', 'marco@example.com')`;
  await db.sql`insert into neon_auth."user" (id, "emailVerified") values ('c1', true), ('c2', true), ('lead', false)`;
});

const deps = (overrides: Partial<Parameters<typeof openTicket>[4]> = {}) => ({
  storefrontTicketUrl: (id: number) => `https://shop.test/support/${id}`,
  sendEmail: async (email: (typeof sent)[number]) => {
    sent.push(email);
  },
  storage,
  ...overrides,
});

const input = (overrides: Partial<NewTicketInput> = {}): NewTicketInput => ({
  subject: "Halaya tub lid cracked on arrival",
  customerId: "c1",
  orderId: null,
  priority: "high",
  description: "Customer called. One tub had a cracked lid.",
  ...overrides,
});

const open = (overrides: Partial<NewTicketInput> = {}, d = deps()) =>
  openTicket(db.sql, db.sql, bernice, input(overrides), d);

describe("finding a Customer for the New ticket dialog", () => {
  it("finds verified Customers by name or email", async () => {
    expect((await searchCustomers(db.sql, "mari")).map((c) => c.name)).toEqual(["Maria Santos"]);
    expect((await searchCustomers(db.sql, "MARK@example")).map((c) => c.id)).toEqual(["c2"]);
  });

  it("never finds a Lead, who has not verified their email", async () => {
    expect(await searchCustomers(db.sql, "Marco")).toEqual([]);
  });

  it("finds nothing for an empty search and treats % as plain text", async () => {
    expect(await searchCustomers(db.sql, "  ")).toEqual([]);
    expect(await searchCustomers(db.sql, "%")).toEqual([]);
  });
});

describe("the Linked order choices", () => {
  it("lists only the chosen Customer's Orders, newest first", async () => {
    await db.sql`insert into orders (customer_id, status, created_at) values
      ('c1', 'delivered', '2026-10-01'), ('c2', 'placed', '2026-10-02'), ('c1', 'paid', '2026-10-10')`;

    const orders = await customerOrders(db.sql, "c1");

    expect(orders.map((o) => o.status)).toEqual(["paid", "delivered"]);
  });
});

describe("opening a Ticket as Staff", () => {
  it("makes a Claimed Ticket whose first Message is the description, visible as Staff's", async () => {
    const result = await open();

    expect(result).toEqual({ ok: true, id: expect.any(Number), emailed: true });
    if (!result.ok) return;

    const [t] = await db.sql`select subject, customer_id, priority, status, order_id, claimed_by_id, claimed_by_name
      from tickets where id = ${result.id}`;
    expect(t).toEqual({
      subject: "Halaya tub lid cracked on arrival",
      customer_id: "c1",
      priority: "high",
      status: "open",
      order_id: null,
      claimed_by_id: "bernice",
      claimed_by_name: "Bernice",
    });
    const messages = await db.sql`select sender, body from ticket_messages where ticket_id = ${result.id}`;
    expect(messages).toEqual([{ sender: "staff", body: "Customer called. One tub had a cracked lid." }]);
  });

  it("links an Order only when it is the Customer's own", async () => {
    const [mine] = await db.sql<{ id: number }[]>`insert into orders (customer_id) values ('c1') returning id`;
    const [theirs] = await db.sql<{ id: number }[]>`insert into orders (customer_id) values ('c2') returning id`;

    expect(await open({ orderId: theirs.id })).toEqual({ ok: false, reason: "order-not-theirs" });
    expect(await open({ orderId: mine.id })).toMatchObject({ ok: true });
    expect(await db.sql`select 1 from tickets`).toHaveLength(1);
  });

  it("refuses someone who is not a verified Customer, such as a Lead or a Walk-in", async () => {
    expect(await open({ customerId: "lead" })).toEqual({ ok: false, reason: "unknown-customer" });
    expect(await open({ customerId: "walk-in-1" })).toEqual({ ok: false, reason: "unknown-customer" });
    expect(await db.sql`select 1 from tickets`).toHaveLength(0);
  });

  it("needs a subject, something to say and a real Priority", async () => {
    expect(await open({ subject: "  " })).toEqual({ ok: false, reason: "empty-subject" });
    expect(await open({ description: " " })).toEqual({ ok: false, reason: "empty-message" });
    expect(await open({ priority: "asap" as never })).toEqual({ ok: false, reason: "invalid-priority" });
  });

  it("emails the Customer once, with a link to the Ticket", async () => {
    const result = await open();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "maria@example.com",
      button: { link: `https://shop.test/support/${result.ok ? result.id : 0}` },
    });
    expect(sent[0].title).toContain("TKT-");
  });

  it("still opens the Ticket when the email cannot be sent, and says so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await open({}, deps({ sendEmail: async () => Promise.reject(new Error("down")) }));

    expect(result).toMatchObject({ ok: true, emailed: false });
    expect(await db.sql`select 1 from tickets`).toHaveLength(1);
  });

  it("sends no email for a Ticket that was refused", async () => {
    await open({ customerId: "lead" });

    expect(sent).toHaveLength(0);
  });
});

describe("the optional image", () => {
  it("is stored Linked to the first Message", async () => {
    const result = await open({ image: { filename: "lid.png", bytes: PNG } });
    if (!result.ok) throw new Error("expected the Ticket to open");

    const [m] = await db.sql<{ id: number; file_id: string }[]>`select id, file_id from ticket_messages where ticket_id = ${result.id}`;
    expect(storage.files.get(m.file_id)).toMatchObject({ contentType: "image/png", link: m.id });
  });

  it("can be the whole first Message", async () => {
    const result = await open({ description: "", image: { filename: "lid.png", bytes: PNG } });

    expect(result).toMatchObject({ ok: true });
  });

  it("refuses a file that is not a JPG or PNG, saving nothing", async () => {
    expect(await open({ image: { filename: "x.png", bytes: PDF } })).toEqual({ ok: false, reason: "invalid-image-type" });
    expect(await db.sql`select 1 from tickets`).toHaveLength(0);
    expect(storage.files.size).toBe(0);
  });

  it("opens nothing when file-storage is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    storage.failUpload = true;

    expect(await open({ image: { filename: "lid.png", bytes: PNG } })).toEqual({ ok: false, reason: "storage-unavailable" });
    expect(await db.sql`select 1 from tickets`).toHaveLength(0);
  });

  it("removes the stored image if the Ticket could not be saved", async () => {
    const failing = deps();
    const broken = { ...db.sql, begin: async () => Promise.reject(new Error("db down")) } as unknown as typeof db.sql;

    await expect(
      openTicket(broken, db.sql, bernice, input({ image: { filename: "lid.png", bytes: PNG } }), failing),
    ).rejects.toThrow("db down");
    expect(storage.files.size).toBe(0);
  });
});
