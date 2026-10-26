import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { addWalkInCustomer, auditCustomerProfileView } from "@/features/customer-profiles/actions";
import { loadCustomerProfile } from "@/features/customer-profiles/profile";
import { startTestDatabase, type TestDatabase } from "./ticket-database";
const audit = vi.hoisted(() => vi.fn<import("@/lib/audit-trail").AuditTrail>(async () => {}));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: async () => ({ id: "portal-17", username: "ana", name: "Ana" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: () => db.sql }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));
let db: TestDatabase;
const ada = { firstName: "Ada", lastName: "Lovelace", mobile: "09171234567" };
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`alter table customers add column contact_number text`;
  await db.sql`create schema crms`;
  const ddl = readFileSync("docs/db/crms-schema.sql", "utf8");
  for (const statement of ddl.replace(/^--.*$/gm, "").split(";").filter(s => /CREATE (TABLE crms.walk_in_customers|UNIQUE INDEX walk_in_customers_)/.test(s))) {
    await db.sql.unsafe(statement);
  }
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { audit.mockReset(); await db.sql`truncate crms.walk_in_customers`; });
it("audits a Walk-in creation once with the saved Target, including when retried", async () => {
  const saved = await addWalkInCustomer(ada);
  expect(saved).toMatchObject({ ok: true });
  await addWalkInCustomer(ada);
  expect(audit).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls[0][0]).toMatchObject({ action: "walk_in_customer.created", module: "Customer Profiles", actor: { type: "user", id: "portal-17", display_name: "Ana" }, target: { type: "walk_in_customer", id: saved.ok ? saved.id : "", display_name: "Ada Lovelace" }, description: "Ana added Walk-in Customer Ada Lovelace.", outcome: "success" });
});

it("audits Walk-in edits, skips unchanged retries and keeps saved edits during an audit outage", async () => {
  const { editWalkInCustomer } = await import("@/features/customer-profiles/actions");
  const saved = await addWalkInCustomer(ada); if (!saved.ok) throw new Error("save failed");
  audit.mockClear();
  expect(await editWalkInCustomer(saved.id, { ...ada, notes: "Prefers pickup" })).toMatchObject({ ok: true });
  await editWalkInCustomer(saved.id, { ...ada, notes: "Prefers pickup" });
  expect(audit).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls[0][0]).toMatchObject({ action: "walk_in_customer.updated", description: "Ana edited Walk-in Customer Ada Lovelace.", outcome: "success" });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  audit.mockRejectedValueOnce(new Error("offline"));
  expect(await editWalkInCustomer(saved.id, { ...ada, notes: "Changed" })).toMatchObject({ ok: true });
  const profile = await loadCustomerProfile(() => db.sql, saved.id);
  expect(profile.ok && profile.profile?.walkIn?.notes).toBe("Changed");
  expect(log).toHaveBeenCalled(); log.mockRestore();
});
it("records successful profile openings with a stable view identity and survives audit failure", async () => {
  const saved = await addWalkInCustomer(ada); if (!saved.ok) throw new Error("save failed");
  audit.mockClear();
  await expect(auditCustomerProfileView(saved.id, "navigation-17")).resolves.toBeUndefined();
  await auditCustomerProfileView(saved.id, "navigation-17");
  expect(audit.mock.calls[0][0]).toMatchObject({ action: "customer_profile.viewed", module: "Customer Profiles", target: { type: "customer_profile", id: saved.id, display_name: "Ada Lovelace" }, description: "Ana opened Customer Profile Ada Lovelace.", operationId: "navigation-17", outcome: "success" });
  expect(audit.mock.calls[0][0].operationId).toBe(audit.mock.calls[1][0].operationId);
  audit.mockClear();
  await auditCustomerProfileView("w-00000000-0000-0000-0000-000000000000", "navigation-17");
  expect(audit).not.toHaveBeenCalled();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  audit.mockRejectedValueOnce(new Error("offline"));
  await expect(auditCustomerProfileView(saved.id, "navigation-17")).resolves.toBeUndefined();
  expect(log).toHaveBeenCalled(); log.mockRestore();
});
it("saves removal of a tag and refuses duplicate contacts without an Audit Event", async () => {
  const { editWalkInCustomer } = await import("@/features/customer-profiles/actions");
  const saved = await addWalkInCustomer({ ...ada, tags: ["VIP", "Pickup"] });
  if (!saved.ok) throw new Error("save failed");
  await addWalkInCustomer({ firstName: "Grace", lastName: "Hopper", mobile: "09181234567" });
  audit.mockClear();
  expect(await editWalkInCustomer(saved.id, { ...ada, tags: ["VIP"] })).toMatchObject({ ok: true });
  const profile = await loadCustomerProfile(() => db.sql, saved.id);
  expect(profile.ok && profile.profile?.walkIn?.tags).toEqual(["VIP"]);
  expect(await editWalkInCustomer(saved.id, { ...ada, mobile: "09181234567" })).toMatchObject({ ok: false, duplicate: { name: "Grace Hopper" } });
  expect(audit).toHaveBeenCalledTimes(1);
});
it("keeps a created Walk-in Customer when the audit trail throws", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  audit.mockRejectedValueOnce(new Error("offline"));
  const saved = await addWalkInCustomer(ada);
  expect(saved).toMatchObject({ ok: true });
  if (saved.ok) expect(await loadCustomerProfile(() => db.sql, saved.id)).toMatchObject({ ok: true, profile: { name: "Ada Lovelace" } });
  expect(log).toHaveBeenCalled(); log.mockRestore();
});

it("records verified Customer openings, but not Leads or missing profiles", async () => {
  await db.sql`insert into customers (id, full_name, email) values ('verified', 'Maria Santos', 'maria@example.com'), ('lead', 'Lead', 'lead@example.com')`;
  await db.sql`insert into neon_auth."user" (id, "emailVerified") values ('verified', true), ('lead', false)`;
  await auditCustomerProfileView("verified", "view-maria");
  await auditCustomerProfileView("lead", "view-lead");
  await auditCustomerProfileView("missing", "view-missing");
  expect(audit).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls[0][0].target).toEqual({ type: "customer_profile", id: "verified", display_name: "Maria Santos" });
});
it("keeps edit submission identity across interleaved replays and the creation Target after contact changes", async () => {
  const { editWalkInCustomer } = await import("@/features/customer-profiles/actions");
  const saved = await addWalkInCustomer(ada, "create-ada");
  if (!saved.ok) throw new Error("save failed");
  audit.mockClear();
  await editWalkInCustomer(saved.id, { ...ada, notes: "A" }, "edit-a");
  await editWalkInCustomer(saved.id, { ...ada, notes: "B" }, "edit-b");
  await editWalkInCustomer(saved.id, { ...ada, notes: "A" }, "edit-a");
  expect(audit.mock.calls[0][0].operationId).toBe(audit.mock.calls[2][0].operationId);
  await editWalkInCustomer(saved.id, { ...ada, mobile: "09191234567" }, "new-contact");
  audit.mockClear();
  expect(await addWalkInCustomer(ada, "create-ada")).toEqual(saved);
  expect(audit).not.toHaveBeenCalled();
});
