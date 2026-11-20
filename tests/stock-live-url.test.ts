import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { staffStockLiveUrl } from "@/features/orders/stock-live-actions";
import { requireModule } from "@/lib/portal/staff";

vi.mock("@/lib/portal/staff", () => ({ requireModule: vi.fn() }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: vi.fn() }));
beforeEach(() => { vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test"); vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "server-key"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

it("issues a staff-stock pass only after the Orders Module check", async () => {
  vi.mocked(requireModule).mockResolvedValue({ id: "staff-1" } as Awaited<ReturnType<typeof requireModule>>);
  const send = vi.fn(async () => Response.json({ ticket: "pass" }));
  vi.stubGlobal("fetch", send);
  expect(await staffStockLiveUrl()).toBe("wss://gateway.test/notifications/stock/staff/live?ticket=pass");
  expect(send).toHaveBeenCalledWith("https://gateway.test/live-tickets", expect.objectContaining({ body: JSON.stringify({ userId: "staff-1", channel: "staff-stock" }) }));
  expect(requireModule).toHaveBeenCalledWith("Orders");
});

it("issues nothing when the Module is refused, and returns null on gateway failure", async () => {
  vi.mocked(requireModule).mockRejectedValueOnce(new Error("denied"));
  const send = vi.fn(); vi.stubGlobal("fetch", send);
  await expect(staffStockLiveUrl()).rejects.toThrow("denied");
  expect(send).not.toHaveBeenCalled();
  vi.mocked(requireModule).mockResolvedValue({ id: "s" } as Awaited<ReturnType<typeof requireModule>>);
  vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await staffStockLiveUrl()).toBeNull();
  log.mockRestore();
});
