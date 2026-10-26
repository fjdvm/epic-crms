import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { gatewayAuditTrail } from "@/lib/gateway";
import { validateSession } from "@/lib/portal/client";
import type { AuditEvent } from "@/lib/audit-trail";

const event: AuditEvent = {
  action: "record.created", module: "Marketing", outcome: "success",
  actor: { type: "user", id: "portal-user-1", display_name: "Ada Okafor" },
  target: { type: "announcement", id: "announcement-1", display_name: "New treats" },
  description: 'Ada Okafor saved the Draft "New treats".',
  occurred_at: "2026-10-27T00:00:00.000Z", operationId: "record.created:announcement-1",
};

beforeEach(() => {
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test/");
  vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "test-caller-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("posts the CRMS event and its stable idempotency key using Caller auth and a five-second timeout", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  const timeout = vi.spyOn(AbortSignal, "timeout");
  await gatewayAuditTrail(event);
  const fields = { ...event };
  Reflect.deleteProperty(fields, "operationId");
  expect(fetch).toHaveBeenCalledWith("https://gateway.test/audit/events", {
    method: "POST", headers: { Authorization: "Bearer test-caller-key", "Content-Type": "application/json" },
    body: expect.any(String), signal: expect.any(AbortSignal),
  });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ ...fields, source: "CRMS", idempotency_key: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(timeout).toHaveBeenCalledWith(5000);
});

it("replays the same event identity after an uncertain delivery without inserting a duplicate", async () => {
  const stored = new Map<string, unknown>();
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    stored.set(body.idempotency_key, body);
    if (++attempts === 1) throw new Error("response lost after save");
    return new Response(null, { status: 201 });
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  await gatewayAuditTrail(event);
  await gatewayAuditTrail(event);
  expect(attempts).toBe(2);
  expect(stored.size).toBe(1);
});

it.each(["refused", "network", "timeout", "configuration"])("logs %s errors and resolves without changing the action result", async (failure) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  if (failure === "configuration") vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "");
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (failure === "network") throw new Error("offline");
    if (failure === "timeout") throw new DOMException("timed out", "TimeoutError");
    return new Response(null, { status: 503 });
  }));
  await expect(gatewayAuditTrail(event)).resolves.toBeUndefined();
  expect(error).toHaveBeenCalledWith("CREOMS Audit Event could not be recorded", expect.any(Error));
});

it("uses validation's Portal User id independently of the Staff username", async () => {
  vi.stubEnv("PORTAL_URL", "https://portal.test");
  vi.stubEnv("PORTAL_SYSTEM_SECRET", "test-secret");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    active: true, user_id: "portal-user-1", staff: { name: "Ada", username: "ada.staff", email: "ada@test.test", role: "Staff" },
  })));
  expect(await validateSession("session", "Marketing")).toMatchObject({ decision: "allowed", staff: { id: "portal-user-1", username: "ada.staff" } });
});

it("keeps distinct occurrences of the same action on the same Target", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  await gatewayAuditTrail(event);
  await gatewayAuditTrail({ ...event, operationId: "another-occurrence" });
  const keys = fetch.mock.calls.map(([, init]) => JSON.parse(init.body).idempotency_key);
  expect(new Set(keys).size).toBe(2);
});

it.each([undefined, "", 42])("refuses validation without a usable Portal User id (%s)", async (user_id) => {
  vi.stubEnv("PORTAL_URL", "https://portal.test");
  vi.stubEnv("PORTAL_SYSTEM_SECRET", "test-secret");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    active: true, user_id, staff: { name: "Ada", username: "ada.staff", email: "ada@test.test", role: "Staff" },
  })));
  expect(await validateSession("session", "Marketing")).toEqual({ decision: "unavailable" });
});
