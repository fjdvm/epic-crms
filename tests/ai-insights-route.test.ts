import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireModule: vi.fn(), decide: vi.fn(), explain: vi.fn() }));
vi.mock("@/lib/portal/staff", async () => ({
  requireModule: mocks.requireModule, heldModules: async (m: string[]) => m,
  canSeeAiInsights: (role: string) => role !== "Staff / Employee",
}));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/lib/db", () => ({ database: () => ({}) }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: vi.fn() }));
vi.mock("@/features/ai-insights/suggestion-store", () => ({ decideSuggestion: mocks.decide, explainSuggestion: mocks.explain }));

import { POST as decide } from "@/app/api/dashboard/ai-insights/route";
import { POST as explain } from "@/app/api/dashboard/ai-insights/explain/route";

const body = { key: "loyal-at-risk", numbers: { customers: 5 }, decision: "dismissed" };
const request = (headers: Record<string, string>, payload: unknown = body, path = "") =>
  new Request(`http://localhost/api/dashboard/ai-insights${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireModule.mockResolvedValue({ id: "s1", name: "Rhea", role: "CREOMS Manager" });
  mocks.decide.mockResolvedValue({ ok: true });
  mocks.explain.mockResolvedValue("Why.");
});

describe("AI Insights routes", () => {
  it("records a decision only from the page itself", async () => {
    expect((await decide(request({}))).status).toBe(403);
    expect((await decide(request({ "x-creoms-ai-insight": "1", "sec-fetch-site": "cross-site" }))).status).toBe(403);
    const res = await decide(request({ "x-creoms-ai-insight": "1" }));
    expect(res.status).toBe(200);
    expect(mocks.decide.mock.calls[0].slice(3)).toEqual([expect.any(Array), "loyal-at-risk", { customers: 5 }, "dismissed"]);
  });

  it("turns Staff away and rejects a malformed decision", async () => {
    mocks.requireModule.mockResolvedValueOnce({ id: "s3", name: "Ana", role: "Staff / Employee" });
    expect((await decide(request({ "x-creoms-ai-insight": "1" }))).status).toBe(403);
    expect((await decide(request({ "x-creoms-ai-insight": "1" }, { ...body, decision: "approve" }))).status).toBe(400);
    expect((await decide(request({ "x-creoms-ai-insight": "1" }, { ...body, numbers: { customers: 1.5 } }))).status).toBe(400);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("passes a refusal reason back with 409", async () => {
    mocks.decide.mockResolvedValueOnce({ ok: false, reason: "This suggestion changed or no longer applies. Reload the page to see the latest." });
    const res = await decide(request({ "x-creoms-ai-insight": "1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toMatch(/changed/);
  });

  it("asks for a why only with its own header", async () => {
    expect((await explain(request({}, { key: "a" }, "/explain"))).status).toBe(403);
    expect(await (await explain(request({ "x-creoms-ai-insight-explain": "1" }, { key: "a" }, "/explain"))).json()).toEqual({ why: "Why." });
  });
});
