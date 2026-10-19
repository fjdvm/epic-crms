import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listCustomers } from "@/features/customer-profiles/customers";
import { addWalkIn, getMergedWalkIn, getWalkIn, listWalkIns } from "@/features/customer-profiles/walk-ins";
import { listNotifications, syncNewCustomers } from "@/features/notifications/notifications";

// Walk-in writes go only to a throwaway schema mirroring crms, created and dropped here. The
// storefront is only ever read, through the read-only role. Skipped without both connections.
const testUrl = process.env.CREOMS_TEST_DATABASE_URL;
const readUrl = process.env.CREOMS_DATABASE_URL;
const enabled = Boolean(testUrl && readUrl);
const schema = `crms_test_walkin_${process.pid}_${Date.now()}`;
const writer = testUrl ? postgres(testUrl, { max: 4 }) : (undefined as unknown as postgres.Sql);
const reader = readUrl ? postgres(readUrl, { max: 2 }) : (undefined as unknown as postgres.Sql);

function mirrorStatements(): string[] {
  return readFileSync("docs/db/crms-schema.sql", "utf8")
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !/^create (role|schema)/i.test(s))
    .map((s) => s.replaceAll("crms.", `${schema}.`));
}

const ada = { firstName: "Ada", lastName: "Lovelace", mobile: "0917 123 4567" };

describe.skipIf(!enabled)("Walk-in Customers", () => {
  beforeAll(async () => {
    await writer.unsafe(`create schema ${schema}`);
    for (const statement of mirrorStatements()) await writer.unsafe(statement);
  });

  beforeEach(async () => {
    await writer.unsafe(`truncate ${schema}.walk_in_customers, ${schema}.notifications, ${schema}.seen_customers, ${schema}.sync_state`);
  });

  afterAll(async () => {
    await writer.unsafe(`drop schema if exists ${schema} cascade`);
    await writer.end();
    await reader.end();
  });

  it("saves with the required fields only and opens as a profile with those fields", async () => {
    const result = await addWalkIn(reader, writer, ada, schema);

    expect(result.ok).toBe(true);
    if (!result.ok || !("id" in result)) throw new Error("expected a saved Walk-in Customer");

    expect(await getWalkIn(writer, result.id, schema)).toMatchObject({
      id: result.id,
      name: "Ada Lovelace",
      mobile: "09171234567",
      email: null,
      tags: [],
      emailConsent: false,
      smsConsent: false,
      address: null,
    });
  });

  it("keeps every optional field that was entered", async () => {
    const result = await addWalkIn(
      reader,
      writer,
      {
        ...ada,
        email: "Ada@Example.com",
        birthday: "1990-05-17",
        preferredContact: "SMS",
        source: "Event / expo",
        tags: ["wedding", "vip"],
        emailConsent: true,
        smsConsent: true,
        notes: "Wedding order in June",
        address: { street: "1 Rizal St", province: "Metro Manila", city: "Manila", barangay: "Ermita", zip: "1000", landmark: "Near the church" },
      },
      schema,
    );
    if (!result.ok || !("id" in result)) throw new Error("expected a saved Walk-in Customer");

    expect(await getWalkIn(writer, result.id, schema)).toMatchObject({
      email: "ada@example.com",
      birthday: "1990-05-17",
      preferredContact: "SMS",
      source: "Event / expo",
      tags: ["wedding", "vip"],
      emailConsent: true,
      smsConsent: true,
      notes: "Wedding order in June",
      address: { street: "1 Rizal St", province: "Metro Manila", city: "Manila", barangay: "Ermita", zip: "1000", landmark: "Near the church" },
    });
  });

  it("returns field errors without saving anything", async () => {
    const result = await addWalkIn(reader, writer, { firstName: "", lastName: "X", mobile: "123", email: "x@" }, schema);

    expect(result).toMatchObject({ ok: false, errors: { firstName: expect.any(String), mobile: expect.any(String), email: expect.any(String) } });
    expect(await listWalkIns(writer, schema)).toEqual([]);
  });

  it("rejects a duplicate mobile or email of a Walk-in Customer, naming the existing profile", async () => {
    const first = await addWalkIn(reader, writer, { ...ada, email: "ada@example.com" }, schema);
    if (!first.ok || !("id" in first)) throw new Error("expected a saved Walk-in Customer");

    expect(await addWalkIn(reader, writer, { firstName: "Bea", lastName: "B", mobile: "+63 917 123 4567" }, schema)).toEqual({
      ok: false,
      duplicate: { id: first.id, name: "Ada Lovelace", field: "mobile" },
    });
    expect(await addWalkIn(reader, writer, { firstName: "Bea", lastName: "B", mobile: "09181112222", email: "ADA@example.com" }, schema)).toEqual({
      ok: false,
      duplicate: { id: first.id, name: "Ada Lovelace", field: "email" },
    });
  });

  it("saves only one of two concurrent saves of the same person", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => addWalkIn(reader, writer, ada, schema)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && "duplicate" in r)).toHaveLength(3);
    expect(await listWalkIns(writer, schema)).toHaveLength(1);
  });

  it("rejects the email or mobile number of a verified Customer, linking to their profile", async () => {
    const [customer] = await reader<{ id: string; full_name: string; email: string; contact_number: string }[]>`
      select c.id, c.full_name, c.email, c.contact_number
      from public.customers c join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
      limit 1`;
    if (!customer) return;

    expect(
      await addWalkIn(reader, writer, { firstName: "Dup", lastName: "Licate", mobile: "09170000000", email: customer.email.toUpperCase() }, schema),
    ).toEqual({ ok: false, duplicate: { id: customer.id, name: customer.full_name, field: "email" } });

    const digits = customer.contact_number.replace(/\D/g, "").replace(/^63/, "0");
    if (/^09\d{9}$/.test(digits)) {
      expect(await addWalkIn(reader, writer, { firstName: "Dup", lastName: "Licate", mobile: digits }, schema)).toMatchObject({
        ok: false,
        duplicate: { id: customer.id, field: "mobile" },
      });
    }
  });

  it("is not found for an id that is not a Walk-in Customer", async () => {
    expect(await getWalkIn(writer, "not-a-walk-in", schema)).toBeNull();
    expect(await getWalkIn(writer, "w-00000000-0000-0000-0000-000000000000", schema)).toBeNull();
    expect(await getWalkIn(writer, "w-nonsense", schema)).toBeNull();
  });

  it("appears in the list as a New, Walk-in row and counts in the Stage tabs", async () => {
    const before = await listCustomers(reader, { pageSize: 1000 });
    const saved = await addWalkIn(reader, writer, { ...ada, email: "ada@example.com" }, schema);
    if (!saved.ok || !("id" in saved)) throw new Error("expected a saved Walk-in Customer");

    const walkIns = await listWalkIns(writer, schema);
    const after = await listCustomers(reader, { pageSize: 1000, walkIns });

    expect(after.profileCount).toBe(before.profileCount + 1);
    expect(after.stageCounts.new).toBe(before.stageCounts.new + 1);
    expect(after.rows.find((r) => r.id === saved.id)).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@example.com",
      contactNumber: "09171234567",
      orders: 0,
      totalSpent: 0,
      lastOrder: null,
      stage: "new",
      cartHasItems: false,
      walkIn: true,
    });
    expect(after.rows.filter((r) => r.walkIn)).toHaveLength(1);

    const found = await listCustomers(reader, { pageSize: 1000, walkIns, search: "09171234567", stage: "new" });
    expect(found.rows.map((r) => r.id)).toEqual([saved.id]);

    const spaced = await listCustomers(reader, { pageSize: 1000, walkIns, search: "0917 123 4567" });
    expect(spaced.rows.map((r) => r.id)).toEqual([saved.id]);
  });

  describe("when the same email verifies", () => {
    async function aCustomer() {
      const [customer] = await reader<{ id: string; email: string; contact_number: string }[]>`
        select c.id, c.email, c.contact_number
        from public.customers c join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
        limit 1`;

      return customer;
    }

    /** A Walk-in saved before the person verified: inserted directly, as the add form refuses a Customer's email. */
    async function walkInWithEmail(email: string, mobile: string) {
      await writer.unsafe(
        `insert into ${schema}.walk_in_customers (first_name, last_name, mobile, email, tags, notes)
         values ('Pre', 'Verified', $1, $2, '{wedding,vip}', 'Prefers pickup')`,
        [mobile, email.toLowerCase()],
      );
    }

    it("lists the person once and counts them once in the Stage tabs", async () => {
      const customer = await aCustomer();
      if (!customer) return;

      const before = await listCustomers(reader, { pageSize: 1000 });
      await walkInWithEmail(customer.email, "09170001111");

      const after = await listCustomers(reader, { pageSize: 1000, walkIns: await listWalkIns(writer, schema) });

      expect(after.profileCount).toBe(before.profileCount);
      expect(after.stageCounts).toEqual(before.stageCounts);
      expect(after.rows.filter((r) => r.walkIn)).toHaveLength(0);
      expect(after.rows.filter((r) => r.id === customer.id)).toHaveLength(1);
    });

    it("gives the Customer's profile the Walk-in's tags and notes, matched by email", async () => {
      const customer = await aCustomer();
      if (!customer) return;

      expect(await getMergedWalkIn(writer, customer.email, schema)).toBeNull();

      await walkInWithEmail(customer.email, "09170001111");

      expect(await getMergedWalkIn(writer, customer.email.toUpperCase(), schema)).toEqual({
        tags: ["wedding", "vip"],
        notes: "Prefers pickup",
      });
    });

    it("does not merge a Walk-in that shares only the mobile number", async () => {
      const customer = await aCustomer();
      const mobile = customer?.contact_number.replace(/\D/g, "").replace(/^63/, "0");
      if (!customer || !/^09\d{9}$/.test(mobile)) return;

      await walkInWithEmail("someone.else@example.com", mobile);

      const list = await listCustomers(reader, { pageSize: 1000, walkIns: await listWalkIns(writer, schema) });

      expect(list.rows.filter((r) => r.walkIn)).toHaveLength(1);
      expect(await getMergedWalkIn(writer, customer.email, schema)).toBeNull();
    });
  });

  it("produces no New Customer notification", async () => {
    await syncNewCustomers(writer, [], schema);
    await addWalkIn(reader, writer, ada, schema);
    await syncNewCustomers(writer, [], schema);

    expect((await listNotifications(writer, schema)).notifications).toEqual([]);
  });
});
