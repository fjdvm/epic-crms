import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/portal/callback/route";
import { HANDOFF_COOKIE } from "@/lib/portal/config";

const PUBLIC_URL = "https://creoms.buildwrite.me";
// What Next.js sees behind the Azure proxy: the container's own bind address.
const BIND_URL = "https://0.0.0.0:3000/api/portal/callback";

beforeEach(() => {
  vi.stubEnv("CREOMS_APP_URL", `${PUBLIC_URL}/`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Portal callback redirects", () => {
  it("sends a failed handoff to the public sign-in-error page, not the bind address", async () => {
    const response = await GET(new NextRequest(`${BIND_URL}?code=x&state=y`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${PUBLIC_URL}/sign-in-error?reason=failed`);
  });

  it("sends a denied handoff to the public sign-in-error page", async () => {
    const handoff = JSON.stringify({ state: "s", verifier: "v", returnTo: "/" });
    const response = await GET(
      new NextRequest(`${BIND_URL}?error=access_denied`, {
        headers: { cookie: `${HANDOFF_COOKIE}=${encodeURIComponent(handoff)}` },
      }),
    );

    expect(response.headers.get("location")).toBe(`${PUBLIC_URL}/sign-in-error?reason=denied`);
  });
});
