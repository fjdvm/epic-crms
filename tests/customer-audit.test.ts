import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { auditCustomerProfileView } from "@/features/customer-profiles/actions";
import { startTestDatabase, type TestDatabase } from "./ticket-database";
const audit = vi.hoisted(() => vi.fn<import("@/lib/audit-trail").AuditTrail>(async () => {}));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: async () => ({ id: "portal-17", username: "ana", name: "Ana", role: "Staff" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: () => db.sql }));
let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`alter table customers add column contact_number text`;
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  audit.mockReset();
  await db.sql`delete from neon_auth."user"`;
  await db.sql`delete from customers`;
  await db.sql`insert into customers (id, full_name, email) values ('verified', 'Maria Santos', 'maria@example.com'), ('lead', 'Lead', 'lead@example.com')`;
  await db.sql`insert into neon_auth."user" (id, "emailVerified") values ('verified', true), ('lead', false)`;
});
it("records successful profile openings with a stable view identity and survives audit failure", async () => {
  await expect(auditCustomerProfileView("verified", "navigation-17")).resolves.toBeUndefined();
  await auditCustomerProfileView("verified", "navigation-17");
  expect(audit.mock.calls[0][0]).toMatchObject({ action: "customer_profile.viewed", module: "Customer Profiles", target: { type: "customer_profile", id: "verified", display_name: "Maria Santos" }, description: "Ana opened Customer Profile Maria Santos.", operationId: "navigation-17", outcome: "success" });
  expect(audit.mock.calls[0][0].operationId).toBe(audit.mock.calls[1][0].operationId);
  audit.mockClear();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  audit.mockRejectedValueOnce(new Error("offline"));
  await expect(auditCustomerProfileView("verified", "navigation-18")).resolves.toBeUndefined();
  expect(log).toHaveBeenCalled(); log.mockRestore();
});
it("records verified Customer openings, but not Leads or missing profiles", async () => {
  await auditCustomerProfileView("verified", "view-maria");
  await auditCustomerProfileView("lead", "view-lead");
  await auditCustomerProfileView("missing", "view-missing");
  expect(audit).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls[0][0].target).toEqual({ type: "customer_profile", id: "verified", display_name: "Maria Santos" });
});
