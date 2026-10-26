import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { staffNotificationsLiveUrl } from "@/features/notifications/actions";
import { getShell } from "@/lib/portal/staff";

vi.mock("@/lib/portal/staff", () => ({ getShell: vi.fn() }));
beforeEach(() => {
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test"); vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "server-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
it("issues only a shared-channel Live ticket after proving signed-in Staff", async () => {
  vi.mocked(getShell).mockResolvedValue({ staff: { username: "ana", name: "Ana" }, permittedPages: ["/orders"] } as Awaited<ReturnType<typeof getShell>>);
  const send = vi.fn(async () => Response.json({ ticket: "short-lived-pass" }));
  vi.stubGlobal("fetch", send);
  expect(await staffNotificationsLiveUrl()).toBe("wss://gateway.test/notifications/live?ticket=short-lived-pass");
  expect(send).toHaveBeenCalledWith("https://gateway.test/live-tickets", expect.objectContaining({
    headers: { Authorization: "Bearer server-key", "Content-Type": "application/json" }, body: JSON.stringify({ userId: "creoms-staff" }), cache: "no-store",
  }));
});
it("refuses an anonymous, expired or non-Staff session without issuing a ticket", async () => {
  vi.mocked(getShell).mockRejectedValue(new Error("Portal refused"));
  const send = vi.fn(); vi.stubGlobal("fetch", send);
  await expect(staffNotificationsLiveUrl()).rejects.toThrow("Portal refused");
  expect(send).not.toHaveBeenCalled();
});
it("returns null on gateway failure so the existing poll can continue", async () => {
  vi.mocked(getShell).mockResolvedValue({ staff: { username: "ana", name: "Ana" }, permittedPages: ["/orders"] } as Awaited<ReturnType<typeof getShell>>);
  vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await staffNotificationsLiveUrl()).toBeNull();
  log.mockRestore();
});
