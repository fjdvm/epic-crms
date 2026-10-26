import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/api/portal/callback/route";
import { GET as login } from "@/app/api/portal/login/route";
import { accessFor } from "@/lib/portal/access";
import { requireModule, requireAnyModule } from "@/lib/portal/staff";
import { guarded } from "@/lib/portal/in-page";
import { startTestDatabase, type TestDatabase } from "./ticket-database";
import { FakePortal, FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, portalFetch } from "./fake-portal";

const audit = vi.hoisted(() => vi.fn<import("@/lib/audit-trail").AuditTrail>(async () => {}));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));
const session = vi.hoisted(() => ({ handle: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: session.handle }) }),
  headers: async () => new Headers(),
}));
let db: TestDatabase;
let portal: FakePortal;
const ada = { id: "portal-ada", name: "Ada Okafor", username: "ada", email: "ada@example.com", role: "Staff" };
const APP = "http://localhost:3000";

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  // Execute the migration twice: it must also be safe for an existing installation.
  const migration = readFileSync("docs/db/crms-access-audit.sql", "utf8");
  await db.sql.unsafe(migration);
  await db.sql.unsafe(migration);
  await db.sql`truncate crms.access_audit_sessions, crms.access_audit_refusals`;
  portal = new FakePortal();
  portal.addStaff(ada.id, ada, ["Customer Profiles"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("CREOMS_APP_URL", APP);
  vi.stubEnv("CREOMS_DEV_BYPASS", "false");
  audit.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function signIn(staffId = ada.id) {
  portal.signIn(staffId);
  const started = login(new NextRequest(`${APP}/api/portal/login?returnTo=/customer-profiles`));
  const handoff = started.cookies.get("creoms_handoff")!.value;
  const granted = await portal.handle(new Request(started.headers.get("location")!));
  const request = new NextRequest(granted.headers.get("location")!, {
    headers: { cookie: `creoms_handoff=${encodeURIComponent(handoff)}` },
  });
  const response = await callback(request);
  return { response, request, handle: response.cookies.get("creoms_session")!.value };
}

it("records one CRMS sign-in for each exchanged code and none for a replay", async () => {
  const first = await signIn();
  expect(first.response.headers.get("location")).toBe(`${APP}/customer-profiles`);
  expect(audit).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls[0][0]).toMatchObject({
    action: "crms.signed_in", outcome: "success",
    actor: { type: "user", id: ada.id, display_name: ada.name },
    description: "Ada Okafor signed in to CREOMS.",
  });
  expect(audit.mock.calls[0][0]).not.toHaveProperty("module");
  expect(JSON.stringify(audit.mock.calls)).not.toContain(first.handle);
  await callback(first.request);
  expect(audit).toHaveBeenCalledTimes(1);
  await signIn();
  expect(audit).toHaveBeenCalledTimes(2);
  expect(audit.mock.calls[0][0].operationId).not.toBe(audit.mock.calls[1][0].operationId);
});

it("records concurrent refusals once per Staff member and Module in a rolling minute", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T05:00:59Z"));
  const { handle } = await signIn();
  audit.mockClear();
  const refuse = (module = "Tickets", session = handle) => guarded(accessFor(session), module, async () => "secret");
  expect(await Promise.all(Array.from({ length: 6 }, () => refuse()))).toEqual(Array(6).fill({ status: "no-access" }));
  expect(audit).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls[0][0]).toMatchObject({
    action: "crms.access_denied", outcome: "failure",
    actor: { type: "user", id: ada.id, display_name: ada.name },
    target: { type: "module", id: "Tickets", display_name: "Tickets" },
    description: "Ada Okafor was refused the Tickets Module.",
  });
  expect(audit.mock.calls[0][0]).not.toHaveProperty("module");
  vi.setSystemTime(new Date("2026-10-27T05:01:01Z"));
  await refuse(); // A calendar-minute boundary is still inside the cooldown.
  expect(audit).toHaveBeenCalledTimes(1);
  await refuse("Orders");
  expect(audit).toHaveBeenCalledTimes(2);
  const another = await signIn();
  audit.mockClear();
  await refuse("Tickets", another.handle);
  expect(audit).not.toHaveBeenCalled(); // The limit belongs to Staff, not their handle.
  vi.setSystemTime(new Date("2026-10-27T05:01:59Z"));
  await refuse();
  expect(audit).toHaveBeenCalledTimes(1);
  portal.addStaff("ben-id", { ...ada, id: "ben-id", name: "Ben" });
  const ben = await signIn("ben-id");
  audit.mockClear();
  await refuse("Tickets", ben.handle);
  expect(audit.mock.calls[0][0].actor.id).toBe("ben-id");
});

it("keeps sign-in and the refusal result working when the audit trail throws", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  audit.mockRejectedValue(new Error("audit offline"));
  const { handle, response } = await signIn();
  expect(response.headers.get("location")).toBe(`${APP}/customer-profiles`);
  expect(await guarded(accessFor(handle), "Tickets", async () => "secret")).toEqual({ status: "no-access" });
  expect(audit.mock.calls.map(([event]) => event.action)).toEqual(["crms.signed_in", "crms.access_denied"]);
  expect(error).toHaveBeenCalled();
  await guarded(accessFor(handle), "Tickets", async () => "secret");
  expect(audit).toHaveBeenCalledTimes(2);
});

it("does not audit permission discovery, allowed requests, ended sessions or Portal outages", async () => {
  const { handle } = await signIn();
  audit.mockClear();
  await accessFor(handle).overview();
  await accessFor(handle).check("Tickets");
  expect(await guarded(accessFor(handle), "Customer Profiles", async () => "profile")).toEqual({ status: "ok", value: "profile" });
  expect(await guarded(accessFor("unknown"), "Tickets", async () => "secret")).toEqual({ status: "session-ended" });
  portal.unavailable = true;
  expect(await guarded(accessFor(handle), "Tickets", async () => "secret")).toEqual({ status: "unavailable" });
  expect(audit).not.toHaveBeenCalled();
});

it("retains attribution after every Module is revoked, across fresh access checkers", async () => {
  const { handle } = await signIn();
  portal.revoke(ada.id, "Customer Profiles");
  audit.mockClear();
  expect(await guarded(accessFor(handle), "Tickets", async () => "secret")).toEqual({ status: "no-access" });
  expect(audit.mock.calls[0][0].actor).toEqual({ type: "user", id: ada.id, display_name: ada.name });
});

it("identifies a pre-deployment session using another held Module", async () => {
  const { handle } = await signIn();
  // Simulates a session established before the attribution table existed.
  await db.sql`truncate crms.access_audit_sessions`;
  audit.mockClear();
  await guarded(accessFor(handle), "Tickets", async () => "secret");
  expect(audit.mock.calls[0][0].actor.id).toBe(ada.id);
});

it("keeps sign-in and refusal working when audit storage is unavailable", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.sql`drop table crms.access_audit_sessions, crms.access_audit_refusals`;
  const { handle, response } = await signIn();
  expect(response.headers.get("location")).toBe(`${APP}/customer-profiles`);
  expect(audit.mock.calls[0][0].action).toBe("crms.signed_in");
  expect(await guarded(accessFor(handle), "Tickets", async () => "secret")).toEqual({ status: "no-access" });
});

it("audits actual page refusals and redirects to the refusal page", async () => {
  session.handle = (await signIn()).handle;
  audit.mockClear();
  await expect(requireModule("Tickets")).rejects.toThrow("NEXT_REDIRECT");
  expect(audit.mock.calls[0][0].target.id).toBe("Tickets");
  await expect(requireAnyModule(["Orders", "Payments"])).rejects.toThrow("NEXT_REDIRECT");
  expect(audit.mock.calls.map(([event]) => event.target.id)).toEqual(["Tickets", "Orders", "Payments"]);
  audit.mockClear();
  await expect(requireAnyModule(["Customer Profiles", "Fulfilment"])).resolves.toEqual(ada);
  expect(audit).not.toHaveBeenCalled();
});

it("uses the Staff name at refusal time when a live Module can identify them", async () => {
  const { handle } = await signIn();
  portal.addStaff(ada.id, { ...ada, name: "Ada Reyes" });
  audit.mockClear();
  await guarded(accessFor(handle), "Tickets", async () => "secret");
  expect(audit.mock.calls[0][0]).toMatchObject({
    actor: { type: "user", id: ada.id, display_name: "Ada Reyes" },
    description: "Ada Reyes was refused the Tickets Module.",
  });
});
