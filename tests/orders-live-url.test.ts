import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { staffOrdersLiveUrl } from "@/features/orders/live-actions";
import { getShell } from "@/lib/portal/staff";

vi.mock("@/lib/portal/staff", () => ({ getShell: vi.fn() }));
beforeEach(() => {
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test"); vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "server-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
it("issues only a Staff Orders Live ticket after proving signed-in Staff", async () => {
  vi.mocked(getShell).mockResolvedValue({ staff: { id: "staff-1", username: "ana", name: "Ana" }, permittedPages: ["/orders"] } as Awaited<ReturnType<typeof getShell>>);
  const send = vi.fn(async () => Response.json({ ticket: "short-lived-pass" }));
  vi.stubGlobal("fetch", send);
  expect(await staffOrdersLiveUrl()).toBe("wss://gateway.test/notifications/orders/staff/live?ticket=short-lived-pass");
  expect(send).toHaveBeenCalledWith("https://gateway.test/live-tickets", expect.objectContaining({
    headers: { Authorization: "Bearer server-key", "Content-Type": "application/json" }, body: JSON.stringify({ userId: "staff-1", channel: "staff-orders" }), cache: "no-store",
  }));
});
it("refuses an anonymous, expired or non-Staff session without issuing a ticket", async () => {
  vi.mocked(getShell).mockRejectedValue(new Error("Portal refused"));
  const send = vi.fn(); vi.stubGlobal("fetch", send);
  await expect(staffOrdersLiveUrl()).rejects.toThrow("Portal refused");
  expect(send).not.toHaveBeenCalled();
});
it("returns null on gateway failure so the browser can reconnect", async () => {
  vi.mocked(getShell).mockResolvedValue({ staff: { id: "staff-1", username: "ana", name: "Ana" }, permittedPages: ["/orders"] } as Awaited<ReturnType<typeof getShell>>);
  vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await staffOrdersLiveUrl()).toBeNull();
  log.mockRestore();
});
