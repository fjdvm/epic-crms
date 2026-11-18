import { beforeEach, describe, expect, it, vi } from "vitest";

const readPendingProofs = vi.hoisted(() => vi.fn());
const reportLiveError = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/features/orders/proof-reader", () => ({ readPendingProofs }));
vi.mock("@/lib/ai/structured", () => ({ configuredVisionModels: () => [] }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => ({}) }));
vi.mock("@/lib/error-monitor", () => ({ reportLiveError }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: vi.fn() }));
vi.mock("@/features/returns/photo-bytes", () => ({ fetchReturnPhoto: vi.fn() }));

const { GET } = await import("@/app/api/cron/proof-reader/route");
const call = (query = "", authorization?: string) =>
  GET(Object.assign(new Request(`http://localhost/api/cron/proof-reader${query}`, { headers: authorization ? { authorization } : {} }),
    { nextUrl: new URL(`http://localhost/api/cron/proof-reader${query}`) }) as never);

beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = "cron-secret"; });

describe("the Proof reader route", () => {
  it("rejects callers without the cron credential and reads nothing", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("", "Bearer wrong")).status).toBe(401);
    expect(readPendingProofs).not.toHaveBeenCalled();
  });
  it("sweeps, or reads the one proof the storefront names", async () => {
    readPendingProofs.mockResolvedValue({ read: 1, needsReview: 0, skipped: 0 });
    expect((await call("", "Bearer cron-secret")).status).toBe(200);
    expect(readPendingProofs.mock.calls[0][1]).toBeUndefined();
    await call("?proof=9", "Bearer cron-secret");
    expect(readPendingProofs.mock.calls[1][1]).toBe(9);
  });
  it("reports a failed run without leaking details", async () => {
    readPendingProofs.mockRejectedValue(new Error("secret detail"));
    const response = await call("", "Bearer cron-secret");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "proof reader failed" });
    expect(reportLiveError).toHaveBeenCalled();
  });
});
