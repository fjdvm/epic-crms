import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { syncPortalCopies, type PortalCopies } from "@/features/notifications/portal-copies";
import { listNotifications, markAllRead } from "@/features/notifications/notifications";
import { syncOrderEvents } from "@/features/notifications/order-events";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const viewer = { customerProfiles: false, ticketsStaffId: null, feedback: false, orders: true, payments: false, returns: false };
let staff: { id: string; username?: string; modules: string[] }[] = [{ id: "ada", modules: ["Orders"] }, { id: "ben", modules: ["Orders"] }, { id: "cy", modules: ["Payments"] }];
const inbox = new Map<string, { id: string; userId: string; read: boolean; link: string; text: string }>();
let offline = false;
const portal: PortalCopies = {
  recipients: async () => staff,
  async send(copy) {
    if (offline) throw new Error("offline");
    const key = `${copy.key}:${copy.userId}`;
    if (!inbox.has(key)) inbox.set(key, { id: key, userId: copy.userId, read: false, link: copy.link, text: copy.text });
    return inbox.get(key)!;
  },
  async find(userId, key) { return inbox.get(`${key}:${userId}`) ?? null; },
  async status(userId, id) { return [...inbox.values()].find(row => row.userId === userId && row.id === id)!; },
  async markRead(userId, id) { (await this.status(userId, id)).read = true; },
};
const sync = () => syncPortalCopies(db.sql, portal, "https://creoms.test");
beforeAll(async () => {
  db = await startTestDatabase();
  const statements = readFileSync("docs/db/crms-schema.sql", "utf8").replace(/^--.*$/gm, "").split(";").map(s => s.trim())
    .filter(s => s && !/^(create role|grant|set role|reset role|revoke)/i.test(s)).map(s => s.replace(/^(create schema \w+) authorization \w+/i, "$1"));
  for (const statement of statements) await db.sql.unsafe(statement);
  await db.sql.unsafe(readFileSync("docs/db/crms-portal-copies.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-portal-copies.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate crms.notifications, crms.seen_order_events, crms.order_sync_state restart identity cascade`;
  await db.sql`truncate orders, customers restart identity cascade`;
  inbox.clear(); offline = false;
  staff = [{ id: "ada", modules: ["Orders"] }, { id: "ben", modules: ["Orders"] }, { id: "cy", modules: ["Payments"] }];
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Jane Doe', 'jane@test.com')`;
  await syncOrderEvents(db.sql, db.sql);
  await db.sql`insert into orders (customer_id) values ('c1')`;
  await syncOrderEvents(db.sql, db.sql);
});
it("sends one linked Portal copy to each eligible Staff member across repeated and concurrent syncs", async () => {
  await Promise.all([sync(), sync(), sync()]);
  expect([...inbox.values()].map(row => row.userId).sort()).toEqual(["ada", "ben"]);
  expect([...inbox.values()][0]).toMatchObject({ link: "https://creoms.test/orders/1", text: "Jane Doe placed Order #1, which needs a Delivery fee" });
});

it("links a CREOMS mark-all-read to every Portal copy", async () => {
  await sync();
  await markAllRead(db.sql, "crms", viewer);
  await sync();
  expect([...inbox.values()].every(row => row.read)).toBe(true);
});

it("links a Portal read back to the shared CREOMS feed and the other Staff copy", async () => {
  await sync();
  const ada = [...inbox.values()].find(row => row.userId === "ada")!;
  await portal.markRead("ada", ada.id);
  await sync();
  expect((await listNotifications(db.sql, "crms", 20, viewer)).unread).toBe(0);
  expect([...inbox.values()].every(row => row.read)).toBe(true);
});

it("never creates a missed copy after its Staff member loses the Module", async () => {
  offline = true;
  await sync();
  expect((await listNotifications(db.sql, "crms", 20, viewer)).unread).toBe(1);
  staff = [];
  offline = false;
  await sync(); await sync();
  expect(inbox.size).toBe(0);
  await markAllRead(db.sql, "crms", viewer); await sync();
  expect(inbox.size).toBe(0);
  expect([...inbox.values()].every(row => row.read)).toBe(true);
});

it("retries an uncertain response without duplicates and does not prevent another recipient's copy", async () => {
  const uncertain: PortalCopies = { ...portal, async send(copy) {
    const result = await portal.send(copy);
    if (copy.userId === "ada") throw new Error("response lost after delivery");
    return result;
  } };
  await syncPortalCopies(db.sql, uncertain, "https://creoms.test");
  expect(inbox.size).toBe(2);
  await sync();
  expect(inbox.size).toBe(2);
});

it("uses Payments eligibility for proof copies", async () => {
  await db.sql`insert into crms.notifications (kind, customer_id, customer_name, order_id)
    values ('order-payment-proof', 'c1', 'Jane Doe', 1), ('new-customer', 'c1', 'Jane Doe', null)`;
  await sync();
  expect([...inbox.values()].map(row => row.userId).sort()).toEqual(["ada", "ben", "cy"]);
  expect([...inbox.values()].find(row => row.userId === "cy")?.text).toBe("Jane Doe submitted Payment proof for Order #1");
});

it("still reconciles existing reads when the Portal directory is unavailable for a new alert", async () => {
  await sync();
  await db.sql`insert into crms.notifications (kind, customer_id, customer_name, order_id)
    values ('order-placed', 'c1', 'Jane Doe', 2)`;
  await markAllRead(db.sql, "crms", viewer);
  await syncPortalCopies(db.sql, { ...portal, recipients: async () => { throw new Error("directory offline"); } }, "https://creoms.test");
  expect([...inbox.values()].every(row => row.read)).toBe(true);
});

it("retries a failed linked read without making the CREOMS row unread again", async () => {
  await sync();
  await markAllRead(db.sql, "crms", viewer);
  await syncPortalCopies(db.sql, { ...portal, markRead: async () => { throw new Error("read offline"); } }, "https://creoms.test");
  expect((await listNotifications(db.sql, "crms", 20, viewer)).unread).toBe(0);
  expect([...inbox.values()].some(row => !row.read)).toBe(true);
  await sync();
  expect([...inbox.values()].every(row => row.read)).toBe(true);
});

it("keeps delivered copies and their shared read link after every Module is revoked", async () => {
  await sync();
  staff = [];
  await portal.markRead("ada", [...inbox.values()].find(row => row.userId === "ada")!.id);
  await sync();
  expect(inbox.size).toBe(2);
  expect((await listNotifications(db.sql, "crms", 20, viewer)).unread).toBe(0);
  expect([...inbox.values()].every(row => row.read)).toBe(true);
});

it("recovers an already-delivered copy after revocation when its send response was lost", async () => {
  await syncPortalCopies(db.sql, { ...portal, send: async copy => { await portal.send(copy); throw new Error("response lost"); } }, "https://creoms.test");
  staff = [];
  await portal.markRead("ada", [...inbox.values()].find(row => row.userId === "ada")!.id);
  await sync();
  expect(inbox.size).toBe(2);
  expect((await listNotifications(db.sql, "crms", 20, viewer)).unread).toBe(0);
  expect([...inbox.values()].every(row => row.read)).toBe(true);
});

const alertCases = [
  ["new-customer", "Customer Profiles", null, "Jane Doe became a Customer", "/customer-profiles/c1"],
  ["ticket-new", "Tickets", null, "Jane Doe raised TKT-7", "/tickets/7"],
  ["ticket-message", "Tickets", null, "Jane Doe sent a message on TKT-7", "/tickets/7"],
  ["ticket-message", "Tickets", "ada.staff", "Jane Doe sent a message on TKT-7", "/tickets/7"],
  ["ticket-not-fixed", "Tickets", "ada.staff", "Jane Doe says TKT-7 is not fixed", "/tickets/7"],
  ["feedback-low", "Feedback", null, "Jane Doe rated Order #1 2 stars", "/customer-profiles/c1#order-1"],
  ["return-requested", "Returns", null, "Jane Doe requested Return RMA-8", "/returns#return-8"],
  ["order-placed", "Orders", null, "Jane Doe placed Order #1", "/orders/1"],
  ["order-delivery-fee", "Orders", null, "Jane Doe placed Order #1, which needs a Delivery fee", "/orders/1"],
  ["order-payment-proof", "Payments", null, "Jane Doe submitted Payment proof for Order #1", "/orders/1"],
] as const;

it.each(alertCases)("copies %s with recipient %s to exactly its feed audience and links reads both ways", async (kind, module, recipient, text, path) => {
  await db.sql`truncate crms.notifications restart identity cascade`;
  staff = [{ id: "ada", username: "ada.staff", modules: [module] }, { id: "ben", username: "ben.staff", modules: [module] },
    { id: "cy", modules: ["Dashboard", "Fulfilment"] }];
  await db.sql`insert into crms.notifications
    (kind, customer_id, customer_name, ticket_id, order_id, rating, return_id, recipient_id)
    values (${kind}, 'c1', 'Jane Doe', 7, 1, 2, 8, ${recipient})`;
  await Promise.all([sync(), sync()]);
  expect([...inbox.values()].map(row => row.userId).sort()).toEqual(recipient ? ["ada"] : ["ada", "ben"]);
  expect([...inbox.values()][0]).toMatchObject({ text, link: `https://creoms.test${path}` });
  const feedViewer = { customerProfiles: true, ticketsStaffId: "ada.staff", feedback: true, orders: true, payments: true, returns: true };
  const ada = [...inbox.values()].find(row => row.userId === "ada")!;
  await portal.markRead("ada", ada.id);
  await sync();
  expect((await listNotifications(db.sql, "crms", 20, feedViewer)).unread).toBe(0);
  expect([...inbox.values()].every(row => row.read)).toBe(true);

  await db.sql`truncate crms.notifications restart identity cascade`;
  inbox.clear();
  await db.sql`insert into crms.notifications
    (kind, customer_id, customer_name, ticket_id, order_id, rating, return_id, recipient_id)
    values (${kind}, 'c1', 'Jane Doe', 7, 1, 2, 8, ${recipient})`;
  await sync();
  await markAllRead(db.sql, "crms", feedViewer);
  await sync();
  expect([...inbox.values()].every(row => row.read)).toBe(true);
});
