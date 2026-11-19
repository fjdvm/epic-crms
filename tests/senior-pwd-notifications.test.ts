import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { describeNotification } from "@/features/notifications/describe";
import { viewerFor } from "@/features/notifications/load";
import { listNotifications, markAllRead, markRead } from "@/features/notifications/notifications";
import { syncSeniorPwdEvents } from "@/features/notifications/senior-pwd-events";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
const PAGE = "/customer-profiles/senior-pwd";

beforeAll(async () => {
  db = await startTestDatabase();
  const statements = readFileSync("docs/db/crms-schema.sql", "utf8")
    .replace(/^--.*$/gm, "").split(";").map(s => s.trim())
    .filter(s => s && !/^(create role|grant|set role|reset role|revoke)/i.test(s))
    // Reconstruct an existing install and exercise the actual upgrade twice.
    .filter(s => !/^create table crms\.(seen_senior_pwd|senior_pwd_sync_state)/i.test(s))
    .map(s => s.replace(", 'senior-pwd-waiting'", "").replace(/verification_id\s+integer,/, ""))
    .map(s => s.replace(/^(create schema \w+) authorization \w+/i, "$1"));
  for (const statement of statements) await db.sql.unsafe(statement);
  const migration = readFileSync("docs/db/crms-senior-pwd-notifications.sql", "utf8");
  await db.sql.unsafe(migration);
  await db.sql.unsafe(migration);
}, 60_000);

afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate customers restart identity cascade`;
  await db.sql`truncate crms.notifications, crms.seen_senior_pwd, crms.senior_pwd_sync_state restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Lito Ramos', 'lito@example.com')`;
});

const sync = () => syncSeniorPwdEvents(db.sql, db.sql);
const viewer = (username = "ada", pages = [PAGE]) => viewerFor({ username }, pages)!;
async function upload(status = "pending") {
  const [row] = await db.sql<{ id: number }[]>`
    insert into senior_pwd_verifications (customer_id, id_type, status, id_hash) values ('c1', 'senior', ${status}, 'h')
    returning id`;
  return row.id;
}

describe("Senior/PWD notifications", () => {
  it("alerts every Staff member with the Senior/PWD Module when an ID is uploaded", async () => {
    await sync();
    const id = await upload();
    expect(await sync()).toEqual({ baselined: false, created: 1 });
    for (const username of ["ada", "ben"]) {
      const feed = await listNotifications(db.sql, "crms", 20, viewer(username));
      expect(feed.unread).toBe(1);
      expect(feed.notifications).toMatchObject([
        { kind: "senior-pwd-waiting", verificationId: id, customerId: "c1", customerName: "Lito Ramos" },
      ]);
      expect(describeNotification(feed.notifications[0])).toEqual({
        text: "Lito Ramos uploaded a Senior/PWD ID to review", href: `${PAGE}/${id}`,
      });
    }
  });

  it("baselines existing verifications without notifying Staff", async () => {
    await upload();
    expect(await sync()).toEqual({ baselined: true, created: 0 });
    expect(await sync()).toEqual({ baselined: false, created: 0 });
    expect(await listNotifications(db.sql, "crms", 20, viewer())).toEqual({ unread: 0, notifications: [] });
  });

  it("alerts once per upload, even if it is decided before the next sync", async () => {
    await sync();
    await upload("approved");
    expect(await sync()).toEqual({ baselined: false, created: 1 });
    expect(await sync()).toEqual({ baselined: false, created: 0 });
  });

  it("never shows or clears these alerts without the Senior/PWD Module", async () => {
    await sync();
    await upload();
    await sync();
    const feed = await listNotifications(db.sql, "crms", 20, viewer());
    for (const page of ["/orders", "/payments", "/returns", "/tickets", "/feedback", "/customer-profiles"]) {
      const other = viewer("ada", [page]);
      expect(await listNotifications(db.sql, "crms", 20, other)).toEqual({ unread: 0, notifications: [] });
      await markRead(db.sql, feed.notifications[0].id, "crms", other);
      await markAllRead(db.sql, "crms", other);
    }
    expect((await listNotifications(db.sql, "crms", 20, viewer())).unread).toBe(1);
    await markRead(db.sql, feed.notifications[0].id, "crms", viewer());
    expect((await listNotifications(db.sql, "crms", 20, viewer())).unread).toBe(0);
  });

  it("keeps one notification across repeated and concurrent syncs", async () => {
    await sync();
    await upload();
    const results = await Promise.all([sync(), sync(), sync()]);
    expect(results.reduce((total, result) => total + result.created, 0)).toBe(1);
    expect((await listNotifications(db.sql, "crms", 20, viewer())).notifications).toHaveLength(1);
  });
});
