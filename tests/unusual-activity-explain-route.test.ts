import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireModule: vi.fn(), heldModules: vi.fn(), explainUnusualActivity: vi.fn() }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: mocks.requireModule, heldModules: mocks.heldModules }));
vi.mock("@/lib/db", () => ({ database: () => ({}) }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/features/dashboard/unusual-activity", () => ({ UNUSUAL_ACTIVITY_MODULES: ["Payments"] }));
vi.mock("@/features/dashboard/unusual-activity-explain", () => ({ explainUnusualActivity: mocks.explainUnusualActivity }));
import { POST } from "@/app/api/dashboard/unusual-activity/explain/route";
const req = (body: unknown, headers: Record<string, string> = { "x-creoms-alert-explain": "1" }) =>
  new Request("http://localhost/x", { method: "POST", headers, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireModule.mockResolvedValue({ id: "s1", role: "CREOMS Manager" });
  mocks.heldModules.mockResolvedValue(["Payments"]);
});
it("refuses cross-site and header-less requests before any work", async () => {
  expect((await POST(req({ key: "a" }, {}))).status).toBe(403);
  expect((await POST(req({ key: "a" }, { "x-creoms-alert-explain": "1", "sec-fetch-site": "cross-site" }))).status).toBe(403);
  expect(mocks.requireModule).not.toHaveBeenCalled();
});
it("rejects a bad key and passes only the key plus server-derived identity", async () => {
  expect((await POST(req({ key: 1 }))).status).toBe(400);
  mocks.explainUnusualActivity.mockResolvedValue({ why: "w", whatToDo: null });
  const res = await POST(req({ key: "a", staffId: "x" }));
  expect(mocks.explainUnusualActivity.mock.calls[0].slice(1)).toEqual([{ id: "s1", role: "CREOMS Manager" }, ["Payments"], "a"]);
  expect((await res.json()).explanation.why).toBe("w");
});
