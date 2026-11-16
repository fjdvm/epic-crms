import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireModule: vi.fn(), explain: vi.fn() }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: mocks.requireModule }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => ({}) }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/features/returns/return-flag-explain", () => ({ explainReturnFlag: mocks.explain }));
import { POST } from "@/app/api/returns/[id]/flag-explanation/route";
const req = (body: unknown, headers: Record<string, string> = { "x-creoms-flag-explain": "1" }) =>
  new Request("http://localhost/x", { method: "POST", headers, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
beforeEach(() => { vi.resetAllMocks(); mocks.requireModule.mockResolvedValue({ id: "s1", name: "R", role: "CREOMS Manager" }); });
it("refuses header-less and cross-site requests before any work", async () => {
  expect((await POST(req({ rule: "similar-photo" }, {}), ctx("1"))).status).toBe(403);
  expect((await POST(req({ rule: "similar-photo" }, { "x-creoms-flag-explain": "1", "sec-fetch-site": "cross-site" }), ctx("1"))).status).toBe(403);
  expect(mocks.requireModule).not.toHaveBeenCalled();
});
it("validates input and maps the outcome to a status", async () => {
  expect((await POST(req({ rule: "x" }), ctx("1"))).status).toBe(400);
  expect((await POST(req({ rule: "similar-photo" }), ctx("abc"))).status).toBe(400);
  mocks.explain.mockResolvedValue({ ok: false, reason: "forbidden" });
  expect((await POST(req({ rule: "similar-photo" }), ctx("1"))).status).toBe(403);
  mocks.explain.mockResolvedValue({ ok: true, explanation: "e" });
  const res = await POST(req({ rule: "similar-photo" }), ctx("1"));
  expect(res.status).toBe(200);
  expect(mocks.explain.mock.calls[0].slice(1)).toEqual([{ id: "s1", name: "R", role: "CREOMS Manager" }, 1, "similar-photo"]);
});
