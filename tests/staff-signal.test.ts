import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/notifications/signal/route";
import { listNotifications } from "@/features/notifications/notifications";
import { syncNotifications } from "@/features/notifications/sync";
import { pollNotifications } from "@/features/notifications/actions";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));
vi.mock("@/lib/db", () => ({ database: () => db.sql }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => db.sql }));
const startRead = vi.fn();
vi.mock("@/features/orders/payment-proof-start", () => ({ startPaymentProofRead: () => startRead() }));
vi.mock("@/features/senior-pwd/id-read-start", () => ({ startIdRead: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/portal/staff", () => ({ getShell: vi.fn(async () => ({ staff: { username: "ana", name: "Ana" }, permittedPages: ["/orders"] })) }));
let db: TestDatabase;
const viewer = { customerProfiles: false, ticketsStaffId: null, feedback: false, orders: true, payments: false, returns: false };
const secret = "test-only-secret-for-creoms-signal-route";
const nudges: object[] = [];
beforeAll(async () => {
  db = await startTestDatabase();
  const statements = readFileSync("docs/db/crms-schema.sql", "utf8").replace(/^--.*$/gm, "").split(";").map(s => s.trim())
    .filter(s => s && !/^(create role|grant|set role|reset role|revoke)/i.test(s)).map(s => s.replace(/^(create schema \w+) authorization \w+/i, "$1"));
  for (const statement of statements) await db.sql.unsafe(statement);
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, order_feedback, orders, customers, neon_auth."user" restart identity cascade`;
  await db.sql`truncate crms.notifications, crms.seen_customers, crms.sync_state, crms.seen_order_events, crms.order_sync_state,
    crms.seen_ticket_events, crms.ticket_sync_state, crms.seen_feedback, crms.feedback_sync_state, crms.seen_returns, crms.return_sync_state, crms.notification_signal_state restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Jane Doe', 'jane@example.com')`;
  vi.stubEnv("CREOMS_SIGNAL_SECRET", secret);
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test"); vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "crms-key");
  nudges.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect(url).toBe("https://gateway.test/notifications/notifications");
    expect(init.headers).toMatchObject({ Authorization: "Bearer crms-key" });
    // A browser can already read the alert at the instant the nudge leaves CREOMS.
    const feed = await listNotifications(db.sql, "crms", 20, viewer);
    expect(feed.unread).toBeGreaterThan(0);
    nudges.push(JSON.parse(String(init.body)));
    return Response.json({ accepted: true });
  });
  await syncNotifications();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
const signal = (token = secret, body?: object) => POST(new NextRequest("https://creoms.test/api/notifications/signal", {
  method: "POST", headers: { Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}),
}));
it("syncs an Order into the feed before sending a content-free shared Staff nudge", async () => {
  await db.sql`insert into orders (customer_id, fulfillment_method) values ('c1', 'pickup')`;
  expect((await signal()).status).toBe(202);
  expect((await listNotifications(db.sql, "crms", 20, viewer)).notifications).toMatchObject([{ kind: "order-placed", orderId: 1 }]);
  expect(nudges).toEqual([{ type: "creoms.staff.changed", title: "Staff feed changed", body: "Refresh the Staff feed.", sendingApp: "crms", targetApp: "crms", userIds: ["creoms-staff"] }]);
});

it("starts the payment Proof reader for an authorised signal only", async () => {
  expect((await signal("wrong")).status).toBe(401);
  expect(startRead).not.toHaveBeenCalled();
  expect((await signal()).status).toBe(202);
  expect(startRead).toHaveBeenCalledTimes(1);
});

it("refuses direct calls without the dedicated gateway credential before any sync", async () => {
  await db.sql`insert into orders (customer_id) values ('c1')`;
  expect((await signal("wrong")).status).toBe(401);
  vi.stubEnv("CREOMS_SIGNAL_SECRET", "");
  expect((await signal()).status).toBe(401);
  expect((await listNotifications(db.sql, "crms", 20, viewer)).unread).toBe(0);
  expect(nudges).toEqual([]);
});
it("coalesces a burst, ignores forged event fields, and keeps one Order alert", async () => {
  await db.sql`insert into orders (customer_id, fulfillment_method, payment_method) values ('c1', 'pickup', 'gcash')`;
  const responses = await Promise.all(Array.from({ length: 20 }, () => signal(secret, { kind: "return", orderId: 999, customerName: "Forged", recipients: ["bob"] })));
  expect(responses.every(response => response.status === 202)).toBe(true);
  const outcomes = await Promise.all(responses.map(response => response.json()));
  expect(outcomes.filter(outcome => !outcome.coalesced)).toHaveLength(1);
  expect((await listNotifications(db.sql, "crms", 20, viewer)).notifications).toMatchObject([{ customerName: "Jane Doe", orderId: 1, kind: "order-placed" }]);
  expect(nudges).toHaveLength(1);
});
it("the poll finds new Orders without any signal, and still applies Module visibility", async () => {
  await db.sql`insert into orders (customer_id, fulfillment_method) values ('c1', 'pickup')`;
  expect(await pollNotifications()).toMatchObject({ unread: 1, notifications: [{ kind: "order-placed", orderId: 1 }] });
  const { getShell } = await import("@/lib/portal/staff");
  vi.mocked(getShell).mockResolvedValueOnce({ staff: { username: "ana", name: "Ana" }, permittedPages: ["/payments"] } as Awaited<ReturnType<typeof getShell>>);
  expect(await pollNotifications()).toEqual({ unread: 0, notifications: [] });
});
it("a nudge outage does not undo a saved alert", async () => {
  vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await db.sql`insert into orders (customer_id) values ('c1')`;
  expect((await signal()).status).toBe(202);
  expect((await pollNotifications())?.unread).toBe(1);
  log.mockRestore();
});
it("a failed feed sync does not hide the Order feed or prevent its nudge", async () => {
  await db.sql`alter table public.order_feedback rename to unavailable_feedback`;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await db.sql`insert into orders (customer_id) values ('c1')`;
    expect((await signal()).status).toBe(202);
    expect((await pollNotifications())?.unread).toBe(1);
    expect(nudges).toHaveLength(1);
  } finally { await db.sql`alter table public.unavailable_feedback rename to order_feedback`; log.mockRestore(); }
});
it("catches up once for an Order arriving during a sync, with no duplicate alerts", async () => {
  const { signalNotifications } = await import("@/features/notifications/signal");
  const { nudgeStaff } = await import("@/features/notifications/staff-live");
  await db.sql`insert into orders (customer_id, fulfillment_method) values ('c1', 'pickup')`;
  let first = true;
  const result = await signalNotifications(db.sql, async () => {
    const batch = await syncNotifications();
    if (first) {
      first = false;
      await db.sql`insert into orders (customer_id) values ('c1')`;
      expect(await (await signal()).json()).toEqual({ accepted: true, coalesced: true });
    }
    return batch;
  }, nudgeStaff);
  expect(result.runs).toBe(2);
  expect((await listNotifications(db.sql, "crms", 20, viewer)).notifications.map(n => n.orderId).sort()).toEqual([1, 2]);
  expect(nudges).toHaveLength(1);
});
it("an interrupted worker's expired lease can be replaced without blocking polling", async () => {
  await db.sql`insert into crms.notification_signal_state (lease_id, lease_until) values (gen_random_uuid(), now() - interval '1 minute')`;
  await db.sql`insert into orders (customer_id) values ('c1')`;
  expect((await signal()).status).toBe(202);
  expect((await pollNotifications())?.unread).toBe(1);
});
it("a signal coordinator outage is visible while the ordinary poll still works", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await db.sql`alter table crms.notification_signal_state rename to unavailable_signals`;
  try {
    await db.sql`insert into orders (customer_id) values ('c1')`;
    expect((await signal()).status).toBe(503);
    expect((await pollNotifications())?.unread).toBe(1);
  } finally { await db.sql`alter table crms.unavailable_signals rename to notification_signal_state`; log.mockRestore(); }
});
