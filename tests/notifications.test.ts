import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  listNotifications,
  markAllRead,
  markRead,
  readCustomers,
  syncNewCustomers,
} from "@/features/notifications/notifications";

// Runs against a throwaway schema mirroring crms, created and dropped here, in a database reached
// through a role that may create schemas. It never touches the real crms schema, and never
// writes to storefront or neon_auth. Skipped when no test connection string is supplied.
const url = process.env.CREOMS_TEST_DATABASE_URL;
const schema = `crms_test_${process.pid}_${Date.now()}`;
const sql = url ? postgres(url, { max: 4 }) : (undefined as unknown as postgres.Sql);

/** The real crms DDL, minus role and schema creation, pointed at the test schema. */
function mirrorStatements(): string[] {
  return readFileSync("docs/db/crms-schema.sql", "utf8")
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !/^create (role|schema)/i.test(s))
    .map((s) => s.replaceAll("crms.", `${schema}.`));
}

const ada = { id: "u-ada", name: "Ada" };
const ben = { id: "u-ben", name: "Ben" };

describe.skipIf(!url)("New Customer notifications", () => {
  beforeAll(async () => {
    await sql.unsafe(`create schema ${schema}`);
    for (const statement of mirrorStatements()) await sql.unsafe(statement);
  });

  beforeEach(async () => {
    await sql.unsafe(`truncate ${schema}.notifications, ${schema}.seen_customers, ${schema}.sync_state`);
  });

  afterAll(async () => {
    await sql.unsafe(`drop schema if exists ${schema} cascade`);
    await sql.end();
  });

  it("creates no notifications for Customers who already exist on the first sync", async () => {
    const result = await syncNewCustomers(sql, [ada, ben], schema);

    expect(result).toEqual({ baselined: true, created: 0 });
    expect(await listNotifications(sql, schema)).toEqual({ unread: 0, notifications: [] });
  });

  it("creates exactly one notification for a newly verified person", async () => {
    await syncNewCustomers(sql, [ada], schema);
    const result = await syncNewCustomers(sql, [ada, ben], schema);

    expect(result.created).toBe(1);

    const feed = await listNotifications(sql, schema);
    expect(feed.unread).toBe(1);
    expect(feed.notifications).toMatchObject([{ customerId: ben.id, customerName: "Ben", read: false }]);
  });

  it("produces no duplicates when synced twice or concurrently", async () => {
    await syncNewCustomers(sql, [ada], schema);

    await Promise.all(Array.from({ length: 5 }, () => syncNewCustomers(sql, [ada, ben], schema)));
    await syncNewCustomers(sql, [ada, ben], schema);

    expect((await listNotifications(sql, schema)).notifications).toHaveLength(1);
  });

  it("gives a Lead no notification until they verify", async () => {
    await syncNewCustomers(sql, [ada], schema);
    await syncNewCustomers(sql, [ada], schema); // ben is still a Lead: not in the Customer list

    expect((await listNotifications(sql, schema)).notifications).toHaveLength(0);

    await syncNewCustomers(sql, [ada, ben], schema); // ben verifies

    expect((await listNotifications(sql, schema)).notifications).toHaveLength(1);
  });

  it("baselines even when there were no Customers yet", async () => {
    await syncNewCustomers(sql, [], schema);
    await syncNewCustomers(sql, [ada], schema);

    expect((await listNotifications(sql, schema)).notifications).toHaveLength(1);
  });

  it("keeps read state shared: marking one or all as read persists", async () => {
    await syncNewCustomers(sql, [], schema);
    await syncNewCustomers(sql, [ada, ben], schema);
    const [first] = (await listNotifications(sql, schema)).notifications;

    await markRead(sql, first.id, schema);
    expect((await listNotifications(sql, schema)).unread).toBe(1);

    await markAllRead(sql, schema);
    expect((await listNotifications(sql, schema)).unread).toBe(0);
  });

  it("rejects a schema name that is not a plain identifier", async () => {
    await expect(listNotifications(sql, "crms; drop table x")).rejects.toThrow("Invalid schema name");
  });
});

const readUrl = process.env.CREOMS_DATABASE_URL;

describe.skipIf(!readUrl)("reading Customers from the storefront", () => {
  const reader = readUrl ? postgres(readUrl, { max: 1 }) : (undefined as unknown as postgres.Sql);

  afterAll(async () => {
    if (readUrl) await reader.end();
  });

  it("returns exactly the verified people", async () => {
    const expected = await reader`
      select c.id from public.customers c, neon_auth."user" u
      where u.id::text = c.id and u."emailVerified" = true`;

    const actual = await readCustomers(reader);

    expect(actual.map((c) => c.id).sort()).toEqual(expected.map((r) => r.id as string).sort());
  });
});
