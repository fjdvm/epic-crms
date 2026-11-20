// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { liveUrl, refetchAll, refetchOne } = vi.hoisted(() => ({ liveUrl: vi.fn(), refetchAll: vi.fn(), refetchOne: vi.fn() }));
vi.mock("@/features/orders/stock-live-actions", () => ({ staffStockLiveUrl: liveUrl, refetchStock: refetchAll, refetchStockSize: refetchOne }));

import { LiveStock } from "@/features/orders/stock-live";
import { shopShows, summarize, type StockPage, type StockRow } from "@/features/orders/stock";

class Socket {
  static all: Socket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn(() => this.onclose?.());
  constructor(readonly url: string) { Socket.all.push(this); }
}
const row = (sizeId: number, product: string, available: number): StockRow =>
  ({ sizeId, product, size: "", image: null, marker: null, inStock: available, reserved: 0, available, shows: shopShows(available), orders: [] });
const pageOf = (rows: StockRow[]): StockPage => ({ rows, imsReachable: true, summary: summarize(rows) });
const elapse = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const send = (data: unknown) => act(async () => { Socket.all[0].onmessage?.({ data: JSON.stringify(data) }); await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers(); Socket.all = []; vi.stubGlobal("WebSocket", Socket);
  liveUrl.mockResolvedValue("wss://gateway/notifications/stock/staff/live?ticket=pass");
  refetchAll.mockResolvedValue({ ok: true, page: pageOf([row(1, "Alpha", 20)]) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("updates the affected Size on an event without refetching the rest, and shows a new product live", async () => {
  render(<LiveStock page={pageOf([row(1, "Alpha", 20)])} />); await elapse();
  await act(async () => { Socket.all[0].onopen?.(); await vi.advanceTimersByTimeAsync(0); });
  expect(refetchAll).toHaveBeenCalledTimes(1);
  refetchOne.mockResolvedValueOnce({ ok: true, row: row(1, "Alpha", 3) });
  await send({ type: "stock.changed", sizeId: 1 });
  expect(refetchOne).toHaveBeenCalledWith(1);
  expect(screen.getByText("Only 3 left")).toBeTruthy();
  refetchOne.mockResolvedValueOnce({ ok: true, row: row(2, "Brand new jam", 50) });
  await send({ type: "stock.changed", sizeId: 2 });
  expect(screen.getByText("Brand new jam")).toBeTruthy();
  expect(refetchAll).toHaveBeenCalledTimes(1);
});

it("falls back to one full refetch when a Size cannot be refetched, and ignores frames that are not stock events", async () => {
  render(<LiveStock page={pageOf([row(1, "Alpha", 20)])} />); await elapse();
  refetchOne.mockResolvedValueOnce({ ok: false });
  await send({ type: "stock.changed", sizeId: 1 });
  await send({ type: "other", sizeId: 1 });
  await act(async () => { Socket.all[0].onmessage?.({ data: "pong" }); });
  expect(refetchOne).toHaveBeenCalledTimes(1);
  expect(refetchAll).toHaveBeenCalledTimes(1); // the failed Size falls back to one full refetch, not a loop
  expect(screen.getByText("Alpha")).toBeTruthy();
});

it("refetches everything on every reconnect, and makes no idle requests or timers", async () => {
  render(<LiveStock page={pageOf([row(1, "Alpha", 20)])} />); await elapse();
  await act(async () => { Socket.all[0].onopen?.(); await vi.advanceTimersByTimeAsync(0); });
  await elapse(120_000);
  expect(refetchAll).toHaveBeenCalledTimes(1);
  expect(liveUrl).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  act(() => Socket.all[0].onclose?.());
  await elapse(1_000);
  expect(Socket.all).toHaveLength(2);
  await act(async () => { Socket.all[1].onopen?.(); await vi.advanceTimersByTimeAsync(0); });
  expect(refetchAll).toHaveBeenCalledTimes(2);
});

it("closes its connection when the page is left", async () => {
  const view = render(<LiveStock page={pageOf([])} />); await elapse();
  view.unmount();
  expect(Socket.all[0].close).toHaveBeenCalledTimes(1);
});
