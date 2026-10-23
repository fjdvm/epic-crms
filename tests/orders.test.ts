import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadOrder, loadOrders, ORDER_TABS } from "@/features/orders/orders";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.sql`truncate order_delivery_addresses, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, first_name, email) values
    ('c1', 'Maria Santos', 'Maria', 'maria@example.com'),
    ('c2', 'Jose Reyes', 'Jose', 'jose@example.com')`;
});

async function order(
  options: {
    customer?: string;
    status?: string;
    fulfillment?: string;
    payment?: string;
    subtotal?: number;
    deliveryFee?: number | null;
    createdAt?: string;
    lines?: [string, number][];
  } = {},
) {
  const [row] = await db.sql<{ id: number }[]>`
    insert into orders (customer_id, status, fulfillment_method, payment_method, subtotal_in_centavos,
      delivery_fee_in_centavos, created_at)
    values (${options.customer ?? "c1"}, ${options.status ?? "placed"}, ${options.fulfillment ?? "delivery"},
      ${options.payment ?? "cash-on-delivery"}, ${options.subtotal ?? 100_000}, ${options.deliveryFee ?? null},
      ${new Date(options.createdAt ?? "2026-10-20T00:00:00Z")})
    returning id`;

  for (const [product, quantity] of options.lines ?? [["Halaya", 1]]) {
    await db.sql`insert into order_lines (order_id, product_name, quantity, price_in_centavos)
      values (${row.id}, ${product}, ${quantity}, 50_000)`;
  }

  return row.id;
}

async function list(query: Parameters<typeof loadOrders>[1] = {}) {
  const result = await loadOrders(() => db.sql, query);
  if (!result.ok) throw new Error("expected the Orders to load");

  return result.list;
}

describe("the Orders list", () => {
  it("has a tab per storefront status, after All", () => {
    expect(ORDER_TABS).toEqual([
      "all",
      "placed",
      "confirmed",
      "awaiting payment",
      "paid",
      "preparing",
      "dispatched",
      "delivered",
      "received",
      "cancelled",
    ]);
  });

  it("counts every status, and All is the sum", async () => {
    await order({ status: "placed" });
    await order({ status: "placed" });
    await order({ status: "paid" });
    await order({ status: "delivered" });
    await order({ status: "cancelled" });

    const { counts } = await list();

    expect(counts).toEqual({
      all: 5,
      placed: 2,
      confirmed: 0,
      "awaiting payment": 0,
      paid: 1,
      preparing: 0,
      dispatched: 0,
      delivered: 1,
      received: 0,
      cancelled: 1,
    });
  });

  it("shows only the Orders of the chosen tab, newest first", async () => {
    const older = await order({ status: "paid", createdAt: "2026-10-18T00:00:00Z" });
    const newer = await order({ status: "paid", createdAt: "2026-10-19T00:00:00Z" });
    await order({ status: "placed" });

    const { rows } = await list({ tab: "paid" });

    expect(rows.map((r) => r.id)).toEqual([newer, older]);
  });

  it("shows All Orders on the All tab", async () => {
    await order({ status: "placed" });
    await order({ status: "delivered" });

    expect((await list({ tab: "all" })).rows).toHaveLength(2);
  });

  it("gives each row its number, date, Customer, items, total and status", async () => {
    const id = await order({
      status: "confirmed",
      subtotal: 120_000,
      deliveryFee: 15_000,
      createdAt: "2026-10-19T00:00:00Z",
      lines: [
        ["Halaya", 2],
        ["Ube Jam", 1],
      ],
    });

    const [row] = (await list()).rows;

    expect(row).toMatchObject({
      id,
      customerId: "c1",
      customerName: "Maria Santos",
      status: "confirmed",
      total: 135_000,
      createdAt: new Date("2026-10-19T00:00:00Z"),
      lines: [
        { product: "Halaya", quantity: 2 },
        { product: "Ube Jam", quantity: 1 },
      ],
    });
  });

  it("derives the payment label from the status", async () => {
    for (const status of ["placed", "confirmed", "awaiting payment", "paid", "preparing", "dispatched", "delivered", "cancelled"]) {
      await order({ status });
    }

    const labels = Object.fromEntries((await list({ pageSize: 50 })).rows.map((r) => [r.status, r.paymentLabel]));

    expect(labels).toEqual({
      placed: "Unpaid",
      confirmed: "Unpaid",
      "awaiting payment": "Unpaid",
      paid: "Paid",
      preparing: "Paid",
      dispatched: "Paid",
      delivered: "Paid",
      cancelled: "Cancelled",
    });
  });

  it("pages the list and keeps counts across pages", async () => {
    for (let i = 0; i < 3; i++) await order({ status: "placed" });

    const second = await list({ tab: "placed", page: 2, pageSize: 2 });

    expect(second.rows).toHaveLength(1);
    expect(second).toMatchObject({ page: 2, totalPages: 2, counts: { placed: 3, all: 3 } });
  });

  it("says so instead of throwing when the database cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await loadOrders(() => {
      throw new Error("CREOMS_DATABASE_URL is not set; see .env.example");
    }, {});

    expect(result).toEqual({ ok: false });
    vi.restoreAllMocks();
  });
});

describe("an Order's detail", () => {
  it("keeps legacy paid Orders readable without Staff attribution", async () => {
    const id = await order({ status: "paid" });
    expect(await loadOrder(() => db.sql, id)).toMatchObject({ ok: true, order: { status: "paid", paidBy: null } });
  });

  it("has the items, Delivery fee, address, Payment proof and Customer", async () => {
    const id = await order({
      status: "awaiting payment",
      payment: "gcash",
      subtotal: 100_000,
      deliveryFee: 15_000,
      lines: [["Halaya", 2]],
    });
    await db.sql`insert into order_delivery_addresses (order_id, street, barangay, city, province, postal_code)
      values (${id}, '1 Rizal St', 'Poblacion', 'Makati', 'Metro Manila', '1210')`;
    await db.sql`update orders set gcash_reference_number = '1234567890',
      payment_proof_submitted_at = ${new Date("2026-10-20T01:00:00Z")} where id = ${id}`;

    const result = await loadOrder(() => db.sql, id);

    expect(result.ok && result.order).toMatchObject({
      id,
      status: "awaiting payment",
      paymentLabel: "Unpaid",
      customer: { id: "c1", name: "Maria Santos" },
      subtotal: 100_000,
      deliveryFee: 15_000,
      total: 115_000,
      lines: [{ product: "Halaya", quantity: 2 }],
      address: { street: "1 Rizal St", city: "Makati" },
      paymentProof: { reference: "1234567890" },
    });
  });

  it("is null for an Order that does not exist", async () => {
    expect(await loadOrder(() => db.sql, 999)).toEqual({ ok: true, order: null });
  });

  it("says so instead of throwing when the database cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await loadOrder(() => {
        throw new Error("no database");
      }, 1),
    ).toEqual({ ok: false });
    vi.restoreAllMocks();
  });
});
