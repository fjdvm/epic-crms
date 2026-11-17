import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ database: () => { throw new Error("must not be reached"); } }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: vi.fn() }));
vi.mock("@/lib/error-monitor", () => ({ reportLiveError: vi.fn(async () => {}) }));

import { GET } from "@/app/api/cron/order-audit/route";

const call = (auth?: string) => GET(new Request("http://x/api/cron/order-audit", { headers: auth ? { authorization: auth } : {} }) as never);

describe("order audit route", () => {
  it("refuses a caller without the cron secret and reads nothing", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
  });

  it("answers 500 when the sweep fails", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call("Bearer s3cret")).status).toBe(500);
  });
});
