import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { addCustomerNote, readCustomerNotes } from "@/features/customer-profiles/note-actions";
import { READ_ONLY_REASON } from "@/lib/portal/roles";
import { startTestDatabase, type TestDatabase } from "./ticket-database";
const mocks = vi.hoisted(() => ({ audit: vi.fn(async () => {}), role: "Staff", name: "Ana", requireModule: vi.fn() }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: mocks.audit }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: mocks.requireModule }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: () => db.sql }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));
let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  const migration = readFileSync("docs/db/crms-customer-notes.sql", "utf8");
  expect(readFileSync("docs/db/crms-schema.sql", "utf8")).toContain(migration);
  await db.sql.unsafe(migration);
  await db.sql`insert into customers (id, full_name, email) values ('customer', 'Maria', 'maria@example.com'), ('lead', 'Lead', 'lead@example.com')`;
  await db.sql`insert into neon_auth."user" (id, "emailVerified") values ('customer', true), ('lead', false)`;
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate crms.customer_notes`;
  mocks.role = "Staff"; mocks.name = "Ana"; mocks.audit.mockReset();
  mocks.requireModule.mockImplementation(async () => ({ id: "staff-1", name: mocks.name, role: mocks.role }));
});
it.each(["Staff", "CREOMS Manager"])("%s saves attributed notes newest first, preserving historical names", async role => {
  mocks.role = role;
  const first = await addCustomerNote("customer", "Prefers pickup", "one");
  expect(first).toMatchObject({ ok: true, note: { text: "Prefers pickup", authorName: "Ana", customerId: "customer" } });
  mocks.name = "Renamed";
  await addCustomerNote("customer", "Call on Saturday", "two");
  const result = await readCustomerNotes("customer");
  expect(result.ok && result.notes.map(n => n.authorName)).toEqual(["Renamed", "Ana"]);
  expect(result.ok && result.notes.every(n => !Number.isNaN(Date.parse(n.createdAt)))).toBe(true);
  expect(mocks.requireModule).toHaveBeenCalledWith("Customer Profiles");
});
it.each(["Admin", "CEO"])("%s reads but cannot write", async role => {
  mocks.role = role;
  expect(await addCustomerNote("customer", "Secret", "one")).toMatchObject({ ok: false, message: READ_ONLY_REASON });
  expect(await readCustomerNotes("customer")).toEqual({ ok: true, notes: [] });
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("rejects blank, excessive and malformed input with plain reasons", async () => {
  for (const text of ["", " \n\t", "x".repeat(2001)]) {
    expect(await addCustomerNote("customer", text, "bad")).toMatchObject({ ok: false, message: expect.any(String) });
  }
  expect(await addCustomerNote("customer", "valid", "")).toMatchObject({ ok: false, message: expect.any(String) });
  expect(await addCustomerNote("lead", "valid", "lead")).toMatchObject({ ok: false, message: expect.any(String) });
  expect(await addCustomerNote("missing", "valid", "missing")).toMatchObject({ ok: false, message: expect.any(String) });
  expect(await addCustomerNote("customer", "x".repeat(2000), "limit")).toMatchObject({ ok: true });
});
it("saves and audits a concurrent retry once without copying note text to the audit", async () => {
  const results = await Promise.all(Array.from({ length: 3 }, () => addCustomerNote("customer", "Private preference", "retry")));
  expect(results[0]).toMatchObject({ ok: true });
  expect(results).toEqual([results[0], results[0], results[0]]);
  expect(await readCustomerNotes("customer")).toMatchObject({ ok: true, notes: [expect.objectContaining({ text: "Private preference" })] });
  expect(mocks.audit).toHaveBeenCalledTimes(1);
  expect(mocks.audit.mock.calls[0]).toEqual([expect.objectContaining({ actor: { type: "user", id: "staff-1", display_name: "Ana" }, target: { type: "customer", id: "customer", display_name: "Maria" }, description: "Ana added a Customer note for Maria." })]);
  expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("Private preference");
  expect(await addCustomerNote("customer", "Changed retry", "retry")).toEqual(results[0]);
});
it("refuses database updates and deletes of permanent Customer notes", async () => {
  await addCustomerNote("customer", "Permanent", "one");
  await expect(db.sql`update crms.customer_notes set body = 'Changed'`).rejects.toThrow("Customer notes are permanent");
  await expect(db.sql`delete from crms.customer_notes`).rejects.toThrow("Customer notes are permanent");
});
