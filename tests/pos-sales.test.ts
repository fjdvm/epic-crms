import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { manilaDays } from "@/features/dashboard/period";
import { salesIn } from "@/features/dashboard/figures";
import { posSalesIn } from "@/features/pos-sales/sales";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const span = manilaDays("2026-11-25", "2026-11-25")!;

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create table sizes (id integer primary key, product_slug text not null, label text not null, price_in_centavos integer not null, ims_product_id integer)`;
  await db.sql`create table stock_reservations (id text primary key, order_id integer, state text not null, lines jsonb not null)`;
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate stock_reservations, sizes`;
  await db.sql`truncate order_returns, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria', 'maria@example.com')`;
  await db.sql`insert into sizes (id, product_slug, label, price_in_centavos, ims_product_id) values
    (1, 'ube-halaya', '250g', 5000, 21), (2, 'ube-halaya', '500g', 9000, 22)`;
});

async function order({ at = "2026-11-25T02:00:00Z", status = "paid", subtotal = 10000, fee = 0, replacementFor = null as number | null } = {}) {
  const [row] = await db.sql<{ id: number }[]>`insert into orders
    (customer_id, created_at, status, subtotal_in_centavos, delivery_fee_in_centavos, payment_method, fulfillment_method, replacement_for_order_id)
    values ('c1', ${new Date(at)}, ${status}, ${subtotal}, ${fee}, 'gcash', 'delivery', ${replacementFor}) returning id`;
  return row.id;
}

async function line(id: number, name: string, size: string, price: number, quantity = 1) {
  const [row] = await db.sql<{ id: number }[]>`insert into order_lines (order_id, product_name, size_label, price_in_centavos, quantity)
    values (${id}, ${name}, ${size}, ${price}, ${quantity}) returning id`;
  return row.id;
}

async function reserve(id: number, lines: { orderLineId: number; sizeId: number; quantity: number }[]) {
  await db.sql`insert into stock_reservations (id, order_id, state, lines) values (${`r${id}`}, ${id}, 'placed', ${db.sql.json(lines)})`;
}

async function refunded(id: number, lineId: number, amount: number, quantity: number, status = "refunded") {
  const [row] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, status, reason, amount_in_centavos)
    values (${id}, ${status}, 'damaged', ${amount}) returning id`;
  await db.sql`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos)
    select ${row.id}, id, product_name, size_label, ${quantity}, price_in_centavos from order_lines where id = ${lineId}`;
}

describe("Online sales for the POS", () => {
  it("lists each product and Size with its IMS product, less refunded quantities, and reconciles to Sales", async () => {
    const id = await order({ subtotal: 32000, fee: 6000 });
    const small = await line(id, "Ube Halaya", "250g", 5000, 2);
    const large = await line(id, "Ube Halaya", "500g", 9000, 2);
    const jam = await line(id, "Ube Jam", "", 4000, 1);
    await reserve(id, [{ orderLineId: small, sizeId: 1, quantity: 2 }, { orderLineId: large, sizeId: 2, quantity: 2 }]);
    await refunded(id, large, 9000, 1);
    await refunded(id, jam, 4000, 1, "replaced");
    const second = await order({ subtotal: 5000 });
    const again = await line(second, "Ube Halaya", "250g", 5000, 1);
    await reserve(second, [{ orderLineId: again, sizeId: 1, quantity: 1 }]);

    const result = await posSalesIn(db.sql, span);

    expect(result).toEqual({
      sales: 34000, orders: 2,
      products: [
        { imsProductId: 21, productName: "Ube Halaya", sizeLabel: "250g", unitsSold: 3, sales: 15000 },
        { imsProductId: 22, productName: "Ube Halaya", sizeLabel: "500g", unitsSold: 1, sales: 9000 },
        { imsProductId: null, productName: "Ube Jam", sizeLabel: "", unitsSold: 1, sales: 4000 },
      ],
      otherSales: 6000,
    });
    expect(result.sales).toBe(await salesIn(db.sql, span));
  });

  it("leaves out unpaid, cancelled and Replacement Orders, Orders outside the days, and fully refunded lines", async () => {
    const paid = await order({ subtotal: 5000 });
    await line(paid, "Ube Halaya", "250g", 5000);
    const gone = await line(paid, "Ube Jam", "", 3000);
    await refunded(paid, gone, 3000, 1);
    for (const status of ["placed", "confirmed", "awaiting payment", "cancelled"]) await line(await order({ status }), "Unpaid", "", 9000);
    await line(await order({ subtotal: 0, replacementFor: paid }), "Replacement", "", 5000);
    await line(await order({ at: "2026-11-24T15:59:59Z" }), "Before", "", 5000);
    await line(await order({ at: "2026-11-25T16:00:00Z" }), "After", "", 5000);
    await line(await order({ at: "2026-11-24T16:00:00Z" }), "First moment", "", 1000);

    const result = await posSalesIn(db.sql, span);

    expect(result.products.map((product) => product.productName)).toEqual(["Ube Halaya", "First moment"]);
    expect(result.orders).toBe(2);
    expect(result.sales).toBe(5000 - 3000 + 10000);
    expect(result.otherSales).toBe(result.sales - 6000);
  });

  it("still answers before the storefront has a Reservation table", async () => {
    await db.sql`alter table stock_reservations rename to stock_reservations_hidden`;
    try {
      await line(await order({ subtotal: 5000 }), "Ube Halaya", "250g", 5000);
      expect((await posSalesIn(db.sql, span)).products).toEqual([
        { imsProductId: null, productName: "Ube Halaya", sizeLabel: "250g", unitsSold: 1, sales: 5000 },
      ]);
    } finally {
      await db.sql`alter table stock_reservations_hidden rename to stock_reservations`;
    }
  });
});

describe("Philippine day ranges", () => {
  it("spans whole Philippine days, both ends included", () => {
    expect(manilaDays("2026-11-01", "2026-11-30")).toEqual({ start: new Date("2026-10-31T16:00:00Z"), end: new Date("2026-11-30T16:00:00Z") });
  });

  it("refuses unreal, reversed and too long ranges, and allows days still to come", () => {
    expect(manilaDays("2026-02-29", "2026-03-01")).toBeNull();
    expect(manilaDays("2026-11-02", "2026-11-01")).toBeNull();
    expect(manilaDays("2025-11-25", "2026-11-26")).toBeNull();
    expect(manilaDays("2025-11-26", "2026-11-26")).not.toBeNull();
    expect(manilaDays("2026-11-01", "2026-11-30")).not.toBeNull();
    expect(manilaDays("2026-13-01", "2026-13-02")).toBeNull();
  });
});
