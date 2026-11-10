// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
const { refresh, liveUrl } = vi.hoisted(() => ({ refresh: vi.fn(), liveUrl: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/orders/live-actions", () => ({ staffOrdersLiveUrl: liveUrl }));
class Socket {
  static all: Socket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn(() => this.onclose?.());
  constructor(readonly url: string) { Socket.all.push(this); }
}
async function elapse(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
beforeEach(() => {
  vi.useFakeTimers(); Socket.all = []; vi.stubGlobal("WebSocket", Socket);
  liveUrl.mockResolvedValue("wss://gateway/notifications/orders/staff/live?ticket=pass");
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("refreshes on connect and orders.changed, and makes no idle requests or timers", async () => {
  render(<BackgroundRefresh />); await elapse();
  expect(Socket.all).toHaveLength(1);
  expect(refresh).not.toHaveBeenCalled();
  act(() => Socket.all[0].onopen?.());
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => Socket.all[0].onmessage?.({ data: '{"type":"orders.changed"}' }));
  expect(refresh).toHaveBeenCalledTimes(2);
  act(() => Socket.all[0].onmessage?.({ data: 'pong' }));
  await elapse(120_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(liveUrl).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("reconnects after a drop and refreshes once on reconnect", async () => {
  render(<BackgroundRefresh />); await elapse();
  act(() => Socket.all[0].onopen?.());
  act(() => Socket.all[0].onclose?.());
  refresh.mockClear();
  await elapse(1_000);
  expect(Socket.all).toHaveLength(2);
  expect(refresh).not.toHaveBeenCalled();
  act(() => Socket.all[1].onopen?.());
  expect(refresh).toHaveBeenCalledTimes(1);
  await elapse(120_000);
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("retries unavailable tickets and stops all work on unmount", async () => {
  liveUrl.mockResolvedValueOnce(null);
  const view = render(<BackgroundRefresh />); await elapse();
  expect(Socket.all).toHaveLength(0);
  await elapse(1_000);
  expect(Socket.all).toHaveLength(1);
  view.unmount();
  expect(Socket.all[0].close).toHaveBeenCalledTimes(1);
  await elapse(120_000);
  expect(liveUrl).toHaveBeenCalledTimes(2);
  expect(refresh).not.toHaveBeenCalled();
});
