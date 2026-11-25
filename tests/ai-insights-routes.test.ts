import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireModule: vi.fn(), dismiss: vi.fn(), answer: vi.fn(), evidence: vi.fn(), run: vi.fn(),
}));
vi.mock("@/lib/portal/staff", async () => {
  const { shopRole } = await import("@/lib/portal/roles");
  return {
    requireModule: mocks.requireModule, heldModules: async (m: string[]) => m,
    canSeeAiInsights: (role: string) => ["manager", "admin"].includes(shopRole(role) ?? ""),
  };
});
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/lib/db", () => ({ database: () => ({}) }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: vi.fn() }));
vi.mock("@/lib/error-monitor", () => ({ reportLiveError: vi.fn() }));
vi.mock("@/features/ai-insights/store", async (original) => ({
  ...(await original<typeof import("@/features/ai-insights/store")>()),
  dismissInsight: mocks.dismiss, answerInsight: mocks.answer, loadEvidence: mocks.evidence,
}));
vi.mock("@/features/ai-insights/run", () => ({ runInsights: mocks.run }));

import { GET as cron } from "@/app/api/cron/ai-insights/route";
import { GET as evidence } from "@/app/api/dashboard/ai-insights/evidence/route";
import { POST } from "@/app/api/dashboard/ai-insights/route";

const post = (payload: unknown, headers: Record<string, string> = { "x-creoms-ai-insight": "1" }) =>
  new Request("http://localhost/api/dashboard/ai-insights", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });
const as = (role: string) => mocks.requireModule.mockResolvedValue({ id: "s1", name: "Rhea", role });

beforeEach(() => {
  vi.clearAllMocks();
  as("CREOMS Manager");
  mocks.dismiss.mockResolvedValue({ ok: true });
  mocks.answer.mockResolvedValue({ ok: true });
  mocks.evidence.mockResolvedValue({ ok: true, records: [] });
  mocks.run.mockResolvedValue([{ days: 7, enoughData: true, insights: 2, worded: true }]);
  vi.stubEnv("CRON_SECRET", "secret");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("the morning run route", () => {
  it("runs only for the scheduler's secret", async () => {
    expect((await cron(new NextRequest("http://localhost/api/cron/ai-insights"))).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
    const res = await cron(new NextRequest("http://localhost/api/cron/ai-insights", { headers: { authorization: "Bearer secret" } }));
    expect(res.status).toBe(200);
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
});

describe("dismiss and feedback", () => {
  it("accepts only requests from the page itself", async () => {
    expect((await POST(post({ action: "dismiss", days: 7, key: "a" }, {}))).status).toBe(403);
    expect((await POST(post({ action: "dismiss", days: 7, key: "a" }, { "x-creoms-ai-insight": "1", "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it("lets Manager-level Roles and Admin dismiss and answer for themselves; Staff are turned away", async () => {
    for (const role of ["CREOMS Manager", "General Manager", "CEO", "VP", "Admin"]) {
      as(role);
      expect((await POST(post({ action: "dismiss", days: 7, key: "a" }))).status).toBe(200);
      expect((await POST(post({ action: "feedback", days: 30, key: "a", helpful: false }))).status).toBe(200);
    }
    expect(mocks.answer.mock.calls[0].slice(3)).toEqual([30, "a", false]);
    as("Staff / Employee");
    expect((await POST(post({ action: "dismiss", days: 7, key: "a" }))).status).toBe(403);
  });

  it("rejects a malformed request and passes a refusal back with its reason", async () => {
    expect((await POST(post({ action: "accept", days: 7, key: "a" }))).status).toBe(400);
    expect((await POST(post({ action: "dismiss", days: 14, key: "a" }))).status).toBe(400);
    expect((await POST(post({ action: "feedback", days: 7, key: "a" }))).status).toBe(400);
    mocks.dismiss.mockResolvedValueOnce({ ok: false, reason: "This insight has been updated. Reload the page to see the latest." });
    const res = await POST(post({ action: "dismiss", days: 7, key: "a" }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toMatch(/updated/);
  });
});

describe("evidence", () => {
  it("is read for Managers and Admin, never for Staff", async () => {
    const url = "http://localhost/api/dashboard/ai-insights/evidence?days=7&key=payments%3Aexpiring";
    expect((await evidence(new Request(url))).status).toBe(200);
    expect(mocks.evidence.mock.calls[0].slice(3)).toEqual([7, "payments:expiring"]);
    as("Admin");
    expect((await evidence(new Request(url))).status).toBe(200);
    as("Staff / Employee");
    expect((await evidence(new Request(url))).status).toBe(403);
    as("CEO");
    expect((await evidence(new Request("http://localhost/api/dashboard/ai-insights/evidence?days=7"))).status).toBe(400);
  });
});
