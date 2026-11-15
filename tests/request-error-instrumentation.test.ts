import { beforeEach, describe, expect, it, vi } from "vitest";

const reportLiveError = vi.fn(async () => {});
vi.mock("@/lib/error-monitor", async (original) => ({ ...(await original<typeof import("@/lib/error-monitor")>()), reportLiveError }));

const { onRequestError } = await import("@/instrumentation");

beforeEach(() => { reportLiveError.mockClear(); vi.stubEnv("NEXT_RUNTIME", "nodejs"); });

describe("uncaught request errors", () => {
  it("reports one kind per route, ignoring the query string", async () => {
    await onRequestError(new TypeError("boom"), { path: "/orders/5?tab=a" });

    expect(reportLiveError).toHaveBeenCalledWith("TypeError at /orders/5", expect.any(TypeError));
  });
});
