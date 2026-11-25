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

  it("ignores a browser that left before the page finished streaming", async () => {
    const aborted = new DOMException("The operation was aborted.", "AbortError");
    const responseAborted = Object.assign(new Error("aborted"), { name: "ResponseAborted" });

    for (const error of [new Error("The destination stream closed early."), aborted, responseAborted]) {
      await onRequestError(error, { path: "/payments" });
    }

    expect(reportLiveError).not.toHaveBeenCalled();
  });

  it("still reports a plain Error with a different message", async () => {
    await onRequestError(new Error("The destination stream closed early, then something else"), { path: "/payments" });

    expect(reportLiveError).toHaveBeenCalledWith("Error at /payments", expect.any(Error));
  });
});
