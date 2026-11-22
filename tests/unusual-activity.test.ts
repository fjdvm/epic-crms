import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { loadUnusualActivity, dismissUnusualActivity } from "@/features/dashboard/unusual-activity";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date("2026-11-16T08:00:00Z");
const staff = { id: "s1", name: "Rhea", username: "rhea", email: "rhea@example.com", role: "CREOMS Manager" };
const modules = ["Payments", "Returns", "Fulfilment"];
const open = (person = staff, held = modules, at = now) => loadUnusualActivity({ source: db.sql, crms: db.sql }, person, held, at);
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-unusual-activity.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate crms.unusual_activity_dismissals, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria', 'maria@example.com')`;
});
async function order(ageHours = 0, rejections = 0) {
  const [row] = await db.sql<{ id: number }[]>`insert into orders
    (customer_id, status, payment_method, payment_proof_submitted_at, payment_proof_rejections)
    values ('c1', 'awaiting payment', 'gcash', ${new Date(+now - ageHours * 3600000)}, ${rejections}) returning id`;
  return row.id;
}
it("fires above five unverified proofs, or at 24 hours, with real numbers and links", async () => {
  for (let i = 0; i < 5; i++) await order();
  expect((await open()).cards).toEqual([]);
  const id = await order();
  expect((await open()).cards[0]).toMatchObject({ key: "unverified-payments", numbers: { count: 6, oldestHours: 0 }, links: expect.arrayContaining([{ label: `Order #${id}`, href: `/orders/${id}` }]) });
  await db.sql`delete from orders where id = ${id}`;
  await db.sql`update orders set payment_proof_submitted_at = ${new Date(+now - 24 * 3600000 + 1)}`;
  expect((await open()).cards).toEqual([]);
  await db.sql`update orders set payment_proof_submitted_at = ${new Date(+now - 24 * 3600000)}`;
  expect((await open()).cards[0].numbers).toEqual({ count: 5, oldestHours: 24 });
});

it("excludes rejected, settled, missing and future proofs from the waiting queue", async () => {
  for (let i = 0; i < 6; i++) await order(25);
  await db.sql`update orders set payment_proof_rejected_at = ${now} where id = 1`;
  await db.sql`update orders set status = 'paid' where id = 2`;
  await db.sql`update orders set payment_proof_submitted_at = null where id = 3`;
  await db.sql`update orders set payment_proof_submitted_at = ${new Date(+now + 3600000)} where id = 4`;
  await db.sql`update orders set payment_method = 'cash-on-delivery' where id = 5`;
  expect((await open()).cards[0].numbers).toEqual({ count: 1, oldestHours: 25 });
});

async function returned(product = "Ube", at = now, status = "requested", sizes = 1) {
  const id = await order();
  const [r] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, reason, amount_in_centavos, requested_at, status)
    values (${id}, 'damaged', 100, ${at}, ${status}) returning id`;
  for (let i = 0; i < sizes; i++) {
    const [line] = await db.sql<{ id: number }[]>`insert into order_lines (order_id, product_name) values (${id}, ${product}) returning id`;
    await db.sql`insert into order_return_items (return_id, order_line_id, product_name, size_label, quantity, price_in_centavos)
      values (${r.id}, ${line.id}, ${product}, ${String(i)}, 1, 100)`;
  }
  return r.id;
}
it("counts distinct Returns per product across sizes, excluding the seven-day boundary, future and declined Returns", async () => {
  await returned("Ube", now, "requested", 2);
  await returned();
  const boundary = new Date(+now - 7 * 24 * 3600000);
  await returned("Ube", boundary);
  await returned("Ube", new Date(+now + 1));
  await returned("Ube", now, "declined");
  await returned("Ube", now, "cancelled");
  await returned("Flan");
  expect((await open(staff, ["Returns"])).cards).toEqual([]);
  const id = await returned("Ube", new Date(+boundary + 1));
  expect((await open(staff, ["Returns"])).cards[0]).toMatchObject({ key: "return-spike:Ube", numbers: { count: 3, days: 7 }, links: expect.arrayContaining([{ label: `Return #${id}`, href: `/returns/${id}` }]) });
});
async function failed(id: number, attempt: string, disposition: string | null = null, rebooked: Date | null = null) {
  await db.sql`insert into failed_deliveries (id, order_id, reason, next_step, customer_message, staff_id, staff_name, disposition, rebooked_at)
    values (${attempt}, ${id}, 'Customer not home', 'rebook', 'Hello', 's1', 'Rhea', ${disposition}, ${rebooked})`;
}
it("fires at three unresolved delivery Orders, excluding duplicate attempts, rebooked, disposed and delivered Orders", async () => {
  const ids = [await order(), await order(), await order(), await order(), await order(), await order()];
  await db.sql`update orders set status = 'dispatched'`;
  await failed(ids[0], "a"); await failed(ids[0], "b"); await failed(ids[1], "c");
  await failed(ids[3], "d", "restock"); await failed(ids[4], "e", null, now);
  await failed(ids[5], "f");
  await db.sql`update orders set status = 'delivered' where id = ${ids[5]}`;
  expect((await open(staff, ["Fulfilment"])).cards).toEqual([]);
  await failed(ids[2], "g");
  expect((await open(staff, ["Fulfilment"])).cards[0]).toMatchObject({ key: "failed-deliveries", numbers: { count: 3 }, links: expect.arrayContaining([{ label: `Order #${ids[2]}`, href: `/orders/${ids[2]}/failed-delivery` }]) });
});
it("warns at two rejected proofs, increases at three, and uses the highest per-Order count per Customer", async () => {
  const id = await order(0, 1);
  expect((await open()).cards).toEqual([]);
  await db.sql`update orders set payment_proof_rejections = 2 where id = ${id}`;
  expect((await open()).cards[0]).toMatchObject({ key: "rejected-proofs:c1", numbers: { count: 2 }, links: [{ label: "Customer", href: "/customer-profiles/c1" }, { label: `Order #${id}`, href: `/orders/${id}` }] });
  await order(0, 3);
  expect((await open()).cards[0].numbers).toEqual({ count: 3 });
  await db.sql`update orders set status = 'paid'`;
  expect((await open()).cards).toEqual([]);
});
it("gates Managers by Module, excludes Staff, permits Admin and CEO to read and fails closed for unknown Roles", async () => {
  await order(24); await returned(); await returned(); await returned();
  expect((await open(staff, [])).cards).toEqual([]);
  expect((await open(staff, ["Returns"])).cards.map(c => c.module)).toEqual(["Returns"]);
  expect((await open({ ...staff, role: "CREOMS Manager" }, ["Payments"])).cards.map(c => c.module)).toEqual(["Payments"]);
  for (const role of ["Admin", "CEO"]) {
    expect((await open({ ...staff, role }, [])).cards).toHaveLength(2);
    expect(await dismissUnusualActivity({ source: db.sql, crms: db.sql }, { ...staff, role }, modules, "unverified-payments", { count: 1, oldestHours: 24 }, now)).toMatchObject({ ok: false });
  }
  for (const role of ["Staff", "Staff/Employee", "Customer"]) {
    expect((await open({ ...staff, role })).cards).toEqual([]);
    expect(await dismissUnusualActivity({ source: db.sql, crms: db.sql }, { ...staff, role }, modules,
      "unverified-payments", { count: 1, oldestHours: 24 }, now)).toMatchObject({ ok: false });
  }
});
it("returns at most five cards by descending urgency with a stable tie break", async () => {
  for (let i = 0; i < 7; i++) {
    await db.sql`insert into customers (id, full_name, email) values (${`c${i + 2}`}, 'Name', 'x@example.com')`;
    const id = await order(0, i + 2);
    await db.sql`update orders set customer_id = ${`c${i + 2}`} where id = ${id}`;
  }
  const cards = (await open()).cards;
  expect(cards).toHaveLength(5);
  expect(cards.map(c => c.key)).toEqual(["rejected-proofs:c8", "rejected-proofs:c7", "rejected-proofs:c6", "rejected-proofs:c5", "rejected-proofs:c4"]);
});
it("dismisses per person, stays hidden on equal or improved numbers and returns only on worsening", async () => {
  const id = await order(24);
  const card = (await open()).cards[0];
  expect(await dismissUnusualActivity({ source: db.sql, crms: db.sql }, staff, modules, card.key, card.numbers, now)).toEqual({ ok: true });
  expect((await open()).cards).toEqual([]);
  expect((await open({ ...staff, id: "s2" })).cards).toHaveLength(1);
  await db.sql`update orders set payment_proof_submitted_at = ${now} where id = ${id}`;
  expect((await open()).cards).toEqual([]);
  await db.sql`update orders set payment_proof_submitted_at = ${new Date(+now - 24 * 3600000)} where id = ${id}`;
  expect((await open()).cards).toEqual([]);
  expect((await open(staff, modules, new Date(+now + 3600000))).cards[0].numbers.oldestHours).toBe(25);
  await order();
  expect((await open()).cards[0].numbers.count).toBe(2);
});
it("refuses stale, fabricated or unauthorized dismissals without suppressing current cards", async () => {
  await order(24);
  const deps = { source: db.sql, crms: db.sql };
  for (const [held, numbers] of [[modules, { count: 1000, oldestHours: 9999 }], [[], { count: 1, oldestHours: 24 }]] as const) {
    expect(await dismissUnusualActivity(deps, staff, held, "unverified-payments", numbers, now)).toMatchObject({ ok: false, reason: expect.any(String) });
  }
  expect((await open()).cards).toHaveLength(1);
});
it("reports a failed source Module while keeping other Modules usable", async () => {
  await order(24);
  await db.sql`alter table order_return_items rename to unavailable_items`;
  try {
    expect(await open()).toMatchObject({ cards: [expect.objectContaining({ key: "unverified-payments" })], unavailable: ["Returns"] });
  } finally { await db.sql`alter table unavailable_items rename to order_return_items`; }
});
it("returns a plain refusal on a failed dismissal and preserves the alert", async () => {
  await order(24);
  const card = (await open()).cards[0];
  await db.sql`alter table crms.unusual_activity_dismissals rename to unavailable_dismissals`;
  try {
    expect(await dismissUnusualActivity({ source: db.sql, crms: db.sql }, staff, modules, card.key, card.numbers, now)).toEqual({ ok: false, reason: "Could not dismiss this Unusual activity card. Please try again." });
    expect(await open()).toEqual({ cards: [], unavailable: modules });
  } finally { await db.sql`alter table crms.unavailable_dismissals rename to unusual_activity_dismissals`; }
  expect((await open()).cards).toHaveLength(1);
});

it("keeps each dismissed metric's high-water value when another metric worsens", async () => {
  for (let i = 0; i < 7; i++) await order(24);
  const deps = { source: db.sql, crms: db.sql };
  let card = (await open()).cards[0];
  await dismissUnusualActivity(deps, staff, modules, card.key, card.numbers, now);
  await db.sql`delete from orders where id = 7`;
  const later = new Date(+now + 3600000);
  card = (await open(staff, modules, later)).cards[0];
  expect(card.numbers).toEqual({ count: 6, oldestHours: 25 });
  expect(await dismissUnusualActivity(deps, staff, modules, card.key, card.numbers, later)).toEqual({ ok: true });
  await order(24);
  // Neither metric exceeds what this person already dismissed (7, 25).
  expect((await open()).cards).toEqual([]);
});
