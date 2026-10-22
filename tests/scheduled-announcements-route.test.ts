import { beforeEach, describe, expect, it, vi } from "vitest";

const sendDue = vi.fn();

vi.mock("@/features/marketing/announcements", () => ({ sendDue, storefrontSubscribers: () => ({}) }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => ({}) }));
vi.mock("@/lib/db", () => ({ database: () => ({}) }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditLog: {}, gatewayMarketingMailer: {} }));

const { GET } = await import("@/app/api/cron/scheduled-announcements/route");

const call = (authorization?: string) =>
  GET(new Request("http://localhost/api/cron/scheduled-announcements", { headers: authorization ? { authorization } : {} }) as never);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
});

describe("the scheduled Announcements route", () => {
  it("rejects a caller without the cron credential, and sends nothing", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(sendDue).not.toHaveBeenCalled();
  });

  it("rejects everyone when no cron secret is configured", async () => {
    delete process.env.CRON_SECRET;

    expect((await call("Bearer undefined")).status).toBe(401);
    expect(sendDue).not.toHaveBeenCalled();
  });

  it("sends what is due and returns the run", async () => {
    sendDue.mockResolvedValue({ sent: 1, failed: 0, skipped: 0, unreadable: 0 });

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 1, failed: 0, skipped: 0, unreadable: 0 });
  });

  it("answers 500 when the run throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendDue.mockRejectedValue(new Error("database down"));

    expect((await call("Bearer cron-secret")).status).toBe(500);
  });
});
