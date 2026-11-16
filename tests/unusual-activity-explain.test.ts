import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { explainUnusualActivity, keptExplanations, quotesOnlyAlertFacts } from "@/features/dashboard/unusual-activity-explain";
import { loadUnusualActivity } from "@/features/dashboard/unusual-activity";
import * as structured from "@/lib/ai/structured";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const now = new Date("2026-11-16T08:00:00Z");
const person = (role: string) => ({ id: "s1", name: "Rhea", username: "rhea", email: "rhea@example.com", role });
const manager = person("CREOMS Manager");
const modules = ["Payments", "Returns", "Fulfilment"];
const deps = () => ({ source: db.sql, crms: db.sql });
const models = () => [{ name: "m", model: {} as never }];
let spy: ReturnType<typeof vi.spyOn>;
const reply = (why: string, whatToDo: string) => spy.mockResolvedValue({ ok: true, model: "m", output: { why, whatToDo } });
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-unusual-activity.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-unusual-activity-explanations.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  spy = vi.spyOn(structured, "structuredOutput");
  await db.sql`truncate crms.unusual_activity_explanations, crms.unusual_activity_dismissals, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria', 'maria@example.com')`;
  for (let i = 0; i < 6; i++) await db.sql`insert into orders (customer_id, status, payment_method, payment_proof_submitted_at)
    values ('c1', 'awaiting payment', 'gcash', ${now})`;
});
const explain = (who = manager, at = now) => explainUnusualActivity(deps(), who, modules, "unverified-payments", models, at);

it("makes the explanation once on first sight, keeps it, and sends only masked rule text and numbers", async () => {
  reply("Six proofs are waiting.", "Check the proofs today.");
  expect(await explain()).toEqual({ why: "Six proofs are waiting.", whatToDo: "Check the proofs today." });
  expect(await explain()).toEqual({ why: "Six proofs are waiting.", whatToDo: "Check the proofs today." });
  expect(spy).toHaveBeenCalledTimes(1);
  const [row] = await db.sql`select * from crms.unusual_activity_explanations`;
  expect(row.sent_text).toContain("count=6");
  expect(row.sent_text).not.toMatch(/Order #|maria|\/orders/i);
  expect(row.numbers).toEqual({ count: 6, oldestHours: 0 });
  const cards = (await loadUnusualActivity(deps(), manager, modules, now)).cards;
  expect((await keptExplanations(db.sql, cards)).get("unverified-payments")?.why).toBe("Six proofs are waiting.");
});

it("makes it again only when the numbers get worse", async () => {
  reply("Six proofs.", "Check them.");
  await explain();
  await db.sql`delete from orders where id = 1`;
  await explain();
  expect(spy).toHaveBeenCalledTimes(1);
  await db.sql`insert into orders (customer_id, status, payment_method, payment_proof_submitted_at) values ('c1', 'awaiting payment', 'gcash', ${now}), ('c1', 'awaiting payment', 'gcash', ${now})`;
  reply("Seven proofs.", "Check them now.");
  expect((await explain())?.why).toBe("Seven proofs.");
  expect(spy).toHaveBeenCalledTimes(2);
  const cards = (await loadUnusualActivity(deps(), manager, modules, now)).cards;
  expect((await keptExplanations(db.sql, cards)).size).toBe(1);
});

it("drops text quoting a number or link the alert does not hold", async () => {
  reply("Nine proofs are waiting.", "Check them today.");
  expect(await explain()).toEqual({ why: null, whatToDo: "Check them today." });
  await db.sql`truncate crms.unusual_activity_explanations`;
  reply("Nine proofs.", "Open /orders/999 to fix.");
  expect(await explain()).toBeNull();
  expect(await db.sql`select 1 from crms.unusual_activity_explanations`).toHaveLength(0);
});

it("never causes a call for Admin or CEO, and a failure leaves the alert without an explanation", async () => {
  reply("Six proofs.", "Check them.");
  for (const role of ["Admin", "CEO"]) expect(await explain(person(role))).toBeNull();
  expect(spy).not.toHaveBeenCalled();
  spy.mockResolvedValue({ ok: false, reason: "model-failed" });
  expect(await explain()).toBeNull();
  expect((await loadUnusualActivity(deps(), manager, modules, now)).cards).toHaveLength(1);
  expect(await explainUnusualActivity(deps(), manager, modules, "no-such-alert", models, now)).toBeNull();
});

it("checks quoted facts against the alert's numbers, rule and links", () => {
  const card = { rule: "More than 5 unverified payments", numbers: { count: 6 }, links: [{ label: "Order #12", href: "/orders/12" }] };
  expect(quotesOnlyAlertFacts("6 wait, limit is 5; see /orders/12 and Order #12.", card)).toBe(true);
  expect(quotesOnlyAlertFacts("7 wait.", card)).toBe(false);
  expect(quotesOnlyAlertFacts("See https://example.com", card)).toBe(false);
  expect(quotesOnlyAlertFacts("See /orders/13", card)).toBe(false);
});

it("also catches spelled-out numbers the alert does not hold", () => {
  const card = { rule: "More than 5 unverified payments", numbers: { count: 6 }, links: [] };
  expect(quotesOnlyAlertFacts("Six wait.", card)).toBe(true);
  expect(quotesOnlyAlertFacts("Nine wait.", card)).toBe(false);
});
