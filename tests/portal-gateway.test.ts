import { afterEach, expect, it, vi } from "vitest";
import { portalGateway } from "@/features/notifications/portal-gateway";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("sends as CREOMS to the Portal, recovers a retry by its exact key, and links reads", async () => {
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
    expect(url.pathname).toBe("/notifications/notifications/lookup");
    return Response.json({ notification: { id: "remote-id", type: "creoms.order.7", sendingApp: "CREOMS", readAt: "2026-10-26" } });
  });
  const portal = portalGateway();
  expect(await portal.send({ key: "creoms.order.7", userId: "portal-id", text: "Order #7", link: "https://creoms.test/orders/7" }))
    .toEqual({ id: "remote-id", read: true });
  expect(calls[0].body).toEqual({ idempotencyKey: "creoms.order.7", type: "creoms.order.7", title: "Order #7", body: "Order #7", link: "https://creoms.test/orders/7", sendingApp: "CREOMS", targetApp: "Portal", userIds: ["portal-id"] });
  expect(await portal.status("portal-id", "remote-id")).toEqual({ id: "remote-id", read: true });
  await portal.markRead("portal-id", "remote-id");
  expect(calls.at(-1)?.body).toEqual({ userId: "portal-id", app: "Portal" });
});

it("caps all copy HTTP work under one deadline rather than resetting it per request", async () => {
  vi.useFakeTimers();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "crms-key");
  let pages = 0;
  vi.stubGlobal("fetch", async (_input: string, init: RequestInit) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2_000);
      init.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal!.reason); }, { once: true });
    });
    pages++;
    return Response.json({ notification: null });
  });
  try {
    const portal = portalGateway();
    const result = (async () => { await portal.find("portal-id", "key1"); await portal.find("portal-id", "key2"); })().catch(error => error);
    await vi.advanceTimersByTimeAsync(4_001);
    expect(await result).toMatchObject({ name: "TimeoutError" });
    expect(pages).toBe(1);
  } finally { timeout.mockRestore(); vi.useRealTimers(); }
});

it("retries an old directory response instead of snapshotting Ticket audiences without usernames", async () => {
  vi.stubEnv("PORTAL_URL", "https://portal.test");
  vi.stubEnv("PORTAL_SYSTEM_SECRET", "secret");
  vi.stubGlobal("fetch", async () => Response.json({ staff: [{ id: "portal-id", modules: ["Tickets"] }] }));
  await expect(portalGateway().recipients()).rejects.toThrow("Ticket Staff usernames");
  vi.stubGlobal("fetch", async () => Response.json({ staff: [{ id: "portal-id", username: "ada.staff", modules: ["Tickets"] }] }));
  expect(await portalGateway().recipients()).toEqual([{ id: "portal-id", username: "ada.staff", modules: ["Tickets"] }]);
});
