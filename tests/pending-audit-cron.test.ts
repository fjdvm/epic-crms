import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sweep = vi.hoisted(() => vi.fn(async () => ({ delivered: 2, failed: 1 })));
vi.mock("@/lib/pending-audit", () => ({ deliverPendingAudits: sweep }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => "crms" }));
vi.mock("@/lib/gateway", () => ({ deliverGatewayAuditEvent: "deliver" }));
vi.mock("@/lib/error-monitor", () => ({ reportLiveError: vi.fn() }));

import { GET } from "@/app/api/cron/pending-audits/route";

const call = (authorization?: string) => GET(new NextRequest("https://creoms.test/api/cron/pending-audits", { headers: authorization ? { authorization } : {} }));

describe("pending audit retry job", () => {
  beforeEach(() => { sweep.mockClear(); vi.stubEnv("CRON_SECRET", "s3cret"); });

  it("refuses a caller without the cron secret and sends nothing", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it("retries pending records for an authorised scheduler", async () => {
    const response = await call("Bearer s3cret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ delivered: 2, failed: 1 });
    expect(sweep).toHaveBeenCalledWith("crms", "deliver", { limit: 50 });
  });
});
