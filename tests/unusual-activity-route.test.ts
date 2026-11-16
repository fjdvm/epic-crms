import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireModule: vi.fn(), heldModules: vi.fn(), loadUnusualActivity: vi.fn(), dismissUnusualActivity: vi.fn() }));
vi.mock("@/lib/portal/staff", () => mocks);
vi.mock("@/lib/db", () => ({ database: () => ({}) }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/features/dashboard/unusual-activity", () => ({ ...mocks, UNUSUAL_ACTIVITY_MODULES: ["Payments", "Returns", "Fulfilment"] }));
import { GET, POST } from "@/app/api/dashboard/unusual-activity/route";
const request = (body: unknown, headers: Record<string, string> = { "x-creoms-alert-dismiss": "1" }) => new Request("http://localhost/api/dashboard/unusual-activity", { method: "POST", headers, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireModule.mockResolvedValue({ id: "s1", role: "Staff" });
  mocks.heldModules.mockResolvedValue(["Payments"]);
});
it("checks Dashboard access on each read and passes only server-discovered Modules", async () => {
  mocks.loadUnusualActivity.mockResolvedValue({ cards: [], unavailable: [] });
  const response = await GET();
  expect(mocks.requireModule).toHaveBeenCalledWith("Dashboard");
  expect(mocks.loadUnusualActivity.mock.calls[0].slice(1)).toEqual([{ id: "s1", role: "Staff" }, ["Payments"]]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("does no work after access refusal", async () => {
  mocks.requireModule.mockRejectedValue(new Error("denied"));
  await expect(GET()).rejects.toThrow("denied");
  expect(mocks.loadUnusualActivity).not.toHaveBeenCalled();
});
it("blocks cross-site and form dismissals before any work", async () => {
  for (const headers of [{}, { "x-creoms-alert-dismiss": "1", "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
    expect((await POST(request({}, headers))).status).toBe(403);
  }
  expect(mocks.requireModule).not.toHaveBeenCalled();
});
it("rejects malformed numbers and keys without a database write", async () => {
  for (const body of [null, {}, { key: 1, numbers: {} }, { key: "a", numbers: [] }, { key: "a", numbers: { count: -1 } }, { key: "a", numbers: { count: "3" } }]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  expect(mocks.dismissUnusualActivity).not.toHaveBeenCalled();
});
it("uses the authenticated identity and returns a plain refusal for stale cards", async () => {
  mocks.dismissUnusualActivity.mockResolvedValue({ ok: false, reason: "This alert changed. Refresh the Dashboard." });
  const response = await POST(request({ key: "a", numbers: { count: 3 }, staffId: "someone-else", modules: ["Returns"] }));
  expect(response.status).toBe(409);
  expect(mocks.dismissUnusualActivity.mock.calls[0].slice(1)).toEqual([{ id: "s1", role: "Staff" }, ["Payments"], "a", { count: 3 }]);
  expect((await response.json()).reason).toContain("Refresh");
});
it("keeps the Dashboard usable when the database connection fails", async () => {
  mocks.loadUnusualActivity.mockRejectedValue(new Error("offline"));
  expect(await (await GET()).json()).toEqual({ cards: [], unavailable: ["Payments"] });
  mocks.dismissUnusualActivity.mockRejectedValue(new Error("offline"));
  expect(await (await POST(request({ key: "a", numbers: { count: 3 } }))).json()).toEqual({ ok: false, reason: "Could not dismiss this alert. Please try again." });
});
