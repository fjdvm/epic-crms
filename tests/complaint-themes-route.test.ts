import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireModule: vi.fn(), openComplaintThemes: vi.fn() }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: mocks.requireModule }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => ({}) }));
vi.mock("@/features/feedback/complaint-themes", () => ({ openComplaintThemes: mocks.openComplaintThemes }));
import { POST } from "@/app/api/feedback/complaint-themes/route";
const req = (body: unknown, headers: Record<string, string> = { "x-creoms-complaint-themes": "1" }) =>
  new Request("http://localhost/api/feedback/complaint-themes", { method: "POST", headers, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireModule.mockResolvedValue({ id: "m1", role: "CREOMS Manager" });
});
it("blocks cross-site or header-less calls before any work", async () => {
  for (const h of [{} as Record<string, string>, { "x-creoms-complaint-themes": "1", "sec-fetch-site": "cross-site" }]) expect((await POST(req({}, h))).status).toBe(403);
  expect(mocks.requireModule).not.toHaveBeenCalled();
});
it("rejects malformed periods", async () => {
  for (const b of [null, { from: "yesterday" }, { to: 5 }, { refresh: "yes" }]) expect((await POST(req(b))).status).toBe(400);
  expect(mocks.openComplaintThemes).not.toHaveBeenCalled();
});
it("uses the session Role, passes refresh only when true, and refuses with 403 for Staff", async () => {
  mocks.openComplaintThemes.mockResolvedValue({ themes: null, unavailable: true, refused: "read-only" });
  const res = await POST(req({ from: "2026-01-01", refresh: true, role: "CEO" }));
  expect(res.status).toBe(403);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.openComplaintThemes.mock.calls[0].slice(1)).toEqual([{ id: "m1", role: "CREOMS Manager" }, { from: "2026-01-01", to: undefined }, { refresh: true }]);
});
