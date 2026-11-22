import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-announcements.sql", "utf8"));
  await db.sql`create table crms.other (id int)`;
}, 60_000);
afterAll(async () => { await db?.close(); });

it("drops only the Announcement tables, leaves the customers opt-in column, and is safe to rerun", async () => {
  const optIn = await db.sql`select column_name from information_schema.columns where table_name = 'customers'`;
  const drop = readFileSync("docs/db/crms-marketing-drop.sql", "utf8");
  await db.sql.unsafe(drop);
  await db.sql.unsafe(drop);
  const tables = await db.sql`select table_name from information_schema.tables where table_schema = 'crms'`;
  expect(tables.map(t => t.table_name)).toEqual(["other"]);
  expect(await db.sql`select column_name from information_schema.columns where table_name = 'customers'`).toEqual(optIn);
});
