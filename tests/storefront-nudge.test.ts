import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { STOREFRONT_CHANNEL, nudgeStorefront } from "@/features/management/storefront-nudge";

beforeEach(() => {
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test/");
  vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("posts a payload-free nudge to the storefront's public line through the notification service", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  await nudgeStorefront();
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://gateway.test/notifications/notifications");
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key");
  const body = JSON.parse(String(init.body));
  expect(body).toMatchObject({ type: "storefront.settings.changed", sendingApp: "crms", targetApp: "ecommerce", userIds: [STOREFRONT_CHANNEL] });
  // The nudge says only that something changed: no amount, no Staff name.
  expect(JSON.stringify(body)).not.toMatch(/\d{3,}/);
});

it("fails loudly when the gateway refuses, so the caller can log it", async () => {
  vi.stubGlobal("fetch", async () => new Response("no", { status: 403 }));
  await expect(nudgeStorefront()).rejects.toThrow(/403/);
});
