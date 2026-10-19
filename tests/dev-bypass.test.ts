import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { accessFor } from "@/lib/portal/access";
import { DEV_STAFF, devBypassEnabled } from "@/lib/portal/dev-bypass";

afterEach(() => vi.unstubAllEnvs());

const on = { CREOMS_DEV_BYPASS: "true" } as const;

describe("dev bypass", () => {
  it("is off unless explicitly switched on", () => {
    expect(devBypassEnabled({})).toBe(false);
    expect(devBypassEnabled({ CREOMS_DEV_BYPASS: "false" })).toBe(false);
  });

  it("is on outside production for a local origin", () => {
    expect(devBypassEnabled({ ...on, NODE_ENV: "development" })).toBe(true);
    expect(
      devBypassEnabled({
        ...on,
        NODE_ENV: "test",
        CREOMS_APP_URL: "http://localhost:3000",
      }),
    ).toBe(true);
  });

  it("refuses to start in production", () => {
    expect(() => devBypassEnabled({ ...on, NODE_ENV: "production" })).toThrow(
      /production/,
    );
  });

  it("refuses to start with a deployed origin configured", () => {
    expect(() =>
      devBypassEnabled({
        ...on,
        NODE_ENV: "development",
        CREOMS_APP_URL: "https://creoms.example.com",
      }),
    ).toThrow(/CREOMS_APP_URL/);
  });

  it("refuses to start on a Vercel deployment", () => {
    expect(() =>
      devBypassEnabled({
        ...on,
        NODE_ENV: "development",
        VERCEL_ENV: "preview",
      }),
    ).toThrow(/Vercel/);
  });

  it("stops the server from starting when the environment is unsafe", () => {
    vi.stubEnv("CREOMS_DEV_BYPASS", "true");
    vi.stubEnv("NODE_ENV", "production");

    expect(() => register()).toThrow(/production/);
  });

  it("opens every page as a fully-permitted Staff member, with no session and no Portal", async () => {
    const access = accessFor(undefined, { bypass: true });

    expect(await access.check("Customer Profiles")).toEqual({
      decision: "allowed",
      staff: DEV_STAFF,
    });
    expect(await access.overview()).toMatchObject({
      decision: "allowed",
      staff: DEV_STAFF,
    });
  });
});
