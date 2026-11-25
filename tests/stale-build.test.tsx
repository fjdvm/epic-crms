// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { StaleBuildListener } from "@/components/stale-build-listener";
import { offerRefreshIfStale, STALE_BUILD_TOAST_ID } from "@/lib/stale-build";

const stale = () => Object.assign(new Error('Server Action "00e4" was not found on the server.'), { name: "UnrecognizedActionError" });

afterEach(() => { cleanup(); toast.mockClear(); });

describe("a tab left open across a deploy", () => {
  it("offers one Refresh toast for a missing Server Action", () => {
    expect(offerRefreshIfStale(stale())).toBe(true);
    expect(offerRefreshIfStale(stale())).toBe(true);
    expect(toast).toHaveBeenCalledWith("A new version of CREOMS is available.", expect.objectContaining({
      id: STALE_BUILD_TOAST_ID, duration: Infinity, action: expect.objectContaining({ label: "Refresh" }),
    }));
    // Same id both times, so Sonner shows a single toast.
    expect(new Set(toast.mock.calls.map(([, options]) => options.id))).toEqual(new Set([STALE_BUILD_TOAST_ID]));
  });

  it("leaves every other error alone", () => {
    for (const error of [new Error("boom"), new TypeError("Failed to fetch"), "UnrecognizedActionError", null]) {
      expect(offerRefreshIfStale(error)).toBe(false);
    }
    expect(toast).not.toHaveBeenCalled();
  });

  it("catches a stale call no screen handled", () => {
    render(<StaleBuildListener />);
    const event = Object.assign(new Event("unhandledrejection", { cancelable: true }), { reason: stale(), promise: Promise.resolve() });
    window.dispatchEvent(event);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);

    const other = Object.assign(new Event("unhandledrejection", { cancelable: true }), { reason: new Error("boom"), promise: Promise.resolve() });
    window.dispatchEvent(other);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(other.defaultPrevented).toBe(false);
  });
});
