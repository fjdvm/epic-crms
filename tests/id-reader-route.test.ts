import { beforeEach, describe, expect, it, vi } from "vitest";

const readPendingIdPhotos = vi.hoisted(() => vi.fn());
const reportLiveError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/features/senior-pwd/id-reader", () => ({ readPendingIdPhotos }));
vi.mock("@/lib/ai/structured", () => ({ configuredVisionModels: () => [] }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/lib/db", () => ({ database: () => ({}) }));
vi.mock("@/lib/error-monitor", () => ({ reportLiveError }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: vi.fn() }));
vi.mock("@/features/returns/photo-bytes", () => ({ fetchReturnPhoto: vi.fn() }));

const { GET } = await import("@/app/api/cron/id-reader/route");
const call = (query = "", authorization?: string) =>
  GET(Object.assign(new Request(`http://localhost/api/cron/id-reader${query}`, { headers: authorization ? { authorization } : {} }),
    { nextUrl: new URL(`http://localhost/api/cron/id-reader${query}`) }) as never);

beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = "cron-secret"; });

describe("the ID reader route", () => {
  it("rejects callers without the cron credential and reads nothing", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("", "Bearer wrong")).status).toBe(401);
    expect(readPendingIdPhotos).not.toHaveBeenCalled();
  });
  it("sweeps, or reads the one check named", async () => {
    readPendingIdPhotos.mockResolvedValue({ read: 1, needsReview: 0, skipped: 0 });
    const response = await call("", "Bearer cron-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ read: 1, needsReview: 0, skipped: 0 });
    expect(readPendingIdPhotos.mock.calls[0][1]).toBeUndefined();
    await call("?id=9", "Bearer cron-secret");
    expect(readPendingIdPhotos.mock.calls[1][1]).toBe(9);
    await call("?id=-3", "Bearer cron-secret");
    expect(readPendingIdPhotos.mock.calls[2][1]).toBeUndefined();
  });
  it("reports a failed run and answers 500", async () => {
    readPendingIdPhotos.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call("", "Bearer cron-secret")).status).toBe(500);
    expect(reportLiveError).toHaveBeenCalledWith("cron:id-reader", expect.any(Error));
  });
});
