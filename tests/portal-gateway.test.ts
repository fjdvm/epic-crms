import { afterEach, expect, it, vi } from "vitest";
import { portalGateway } from "@/features/notifications/portal-gateway";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("sends as CREOMS to the Portal, recovers a retry from later inbox pages, and links reads", async () => {
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "crms-key");
  const calls: { url: URL; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    expect(init.headers).toMatchObject({ Authorization: "Bearer crms-key" });
    if (init.method === "POST") return Response.json({ notifications: [] });
    expect(url.searchParams.get("userId")).toBe("portal-id");
    expect(url.searchParams.get("app")).toBe("Portal");
    return Response.json(url.searchParams.has("cursor")
      ? { notifications: [{ id: "remote-id", type: "creoms.order.7", sendingApp: "CREOMS", readAt: "2026-10-26" }], nextCursor: null }
      : { notifications: [{ id: "unrelated", type: "other", sendingApp: "Portal", readAt: null }], nextCursor: "page-2" });
  });
  const portal = portalGateway();
  expect(await portal.send({ key: "creoms.order.7", userId: "portal-id", text: "Order #7", link: "https://creoms.test/orders/7" }))
    .toEqual({ id: "remote-id", read: true });
  expect(calls[0].body).toEqual({ idempotencyKey: "creoms.order.7", type: "creoms.order.7", title: "Order #7", body: "Order #7", link: "https://creoms.test/orders/7", sendingApp: "CREOMS", targetApp: "Portal", userIds: ["portal-id"] });
  expect(await portal.status("portal-id", "remote-id")).toEqual({ id: "remote-id", read: true });
  await portal.markRead("portal-id", "remote-id");
  expect(calls.at(-1)?.body).toEqual({ userId: "portal-id", app: "Portal" });
});
