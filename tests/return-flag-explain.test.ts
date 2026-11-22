import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { explainReturnFlag, quotesOnlyRecord } from "@/features/returns/return-flag-explain";
import * as structured from "@/lib/ai/structured";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
let spy: ReturnType<typeof vi.spyOn>;
const person = (role: string) => ({ id: "s1", name: "Rhea", role });
const manager = person("CREOMS Manager");
const models = () => [{ name: "m", model: {} as never }];
const deps = () => ({ reader: db.sql, crms: db.sql });
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const reply = (explanation: string) => spy.mockResolvedValue({ ok: true, model: "m", output: { explanation } });

beforeAll(async () => {
  db = await startTestDatabase();
  const statements = readFileSync("docs/db/crms-schema.sql", "utf8").replace(/^--.*$/gm, "").split(";").map(s => s.trim())
    .filter(s => s && !/^(create role|grant|set role|reset role|revoke)/i.test(s))
    .map(s => s.replace(/^(create schema \w+) authorization \w+/i, "$1"));
  for (const statement of statements) await db.sql.unsafe(statement);
  await db.sql.unsafe(readFileSync("docs/db/crms-return-flag-explanations.sql", "utf8"));
}, 60_000);
afterAll(async () => { await db.close(); });
let c: number;
beforeEach(async () => {
  spy = vi.spyOn(structured, "structuredOutput");
  await db.sql`truncate customers restart identity cascade`;
  await db.sql`truncate crms.return_flag_explanations`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria Santos', 'maria@example.com')`;
  await db.sql`insert into orders (customer_id, status) values ('c1', 'delivered')`;
  const ids: number[] = [];
  for (const d of [40, 10, 0]) {
    const [r] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, reason, amount_in_centavos, requested_at)
      values (1, 'damaged', 100, ${daysAgo(d)}) returning id`;
    ids.push(r.id);
  }
  c = ids[2];
});
const explain = (who = manager) => explainReturnFlag(deps(), who, c, "frequent-returns", models);

it("lets only a Manager cause a call", async () => {
  for (const role of ["Staff", "Admin", "Unknown"]) {
    expect(await explain(person(role))).toEqual({ ok: false, reason: "forbidden" });
  }
  expect(spy).not.toHaveBeenCalled();
});

it("sends only record data, stores what was sent, and keeps the explanation", async () => {
  reply("This is the 3rd Return in 90 days; RMA-1 and RMA-2 were also for damaged goods.");
  const result = await explain();
  expect(result.ok && result.explanation).toContain("RMA-1");
  const [row] = await db.sql`select * from crms.return_flag_explanations`;
  expect(row.asked_by).toBe("Rhea");
  expect(row.sent_text).toContain("reason: damaged");
  expect(row.sent_text).not.toMatch(/maria|santos|example\.com|photo|fingerprint/i);
  expect(spy.mock.calls[0][0].prompt).toBe(row.sent_text);
  await explain();
  expect(spy).toHaveBeenCalledTimes(1);
});

it("drops text quoting a number or Return not in the record, keeping nothing", async () => {
  reply("This Customer had 7 Returns, including RMA-99.");
  expect(await explain()).toEqual({ ok: false, reason: "unavailable" });
  expect((await db.sql`select 1 from crms.return_flag_explanations`).length).toBe(0);
  expect(quotesOnlyRecord("see https://x.test", new Set())).toBe(false);
});

it("leaves the flag alone on a model failure, and refuses an unflagged Return", async () => {
  spy.mockResolvedValue({ ok: false } as never);
  expect(await explain()).toEqual({ ok: false, reason: "unavailable" });
  spy.mockRejectedValue(new Error("boom"));
  expect(await explain()).toEqual({ ok: false, reason: "unavailable" });
  expect(await explainReturnFlag(deps(), manager, c, "similar-photo", models)).toEqual({ ok: false, reason: "not-flagged" });
});
