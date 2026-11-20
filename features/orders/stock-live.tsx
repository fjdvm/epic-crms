"use client";

import { useEffect, useRef, useState } from "react";

import { refetchStock, refetchStockSize, staffStockLiveUrl } from "./stock-live-actions";
import { withSize, type StockPage } from "./stock";
import { StockView } from "./stock-view";

/**
 * Products & Stocks, kept current by the Staff stock channel. A Size-ID event refetches that Size; a connect
 * or reconnect refetches everything. Nothing here runs on a timer, focus or visibility: the only timers are
 * the reconnect back-off, which makes no data request.
 */
export function LiveStock({ page: initial }: { page: StockPage }) {
  const [page, setPage] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setPage(initial);
  }

  const apply = useRef<(change: (current: StockPage) => StockPage) => void>(() => {});
  useEffect(() => { apply.current = setPage; });

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    // One fetch at a time, so a slow answer never lands over a newer one. A full refetch covers every queued Size.
    const sizes = new Set<number>();
    let everything = false;
    let running = false;
    const drain = async () => {
      if (running) return;
      running = true;
      try {
        while (!stopped && (everything || sizes.size > 0)) {
          try {
            if (everything) {
              everything = false;
              sizes.clear();
              const result = await refetchStock();
              if (result.ok && !stopped) apply.current(() => result.page);
            } else {
              const [id] = sizes;
              sizes.delete(id);
              const result = await refetchStockSize(id);
              if (result.ok && !stopped) apply.current((current) => withSize(current, id, result.row));
            }
          } catch (error) {
            console.error("Stock refetch failed", error);
          }
        }
      } finally {
        running = false;
      }
    };

    const reconnect = () => {
      if (stopped) return;
      const ceiling = Math.min(30_000, 1_000 * 2 ** Math.min(attempts++, 5));
      retry = setTimeout(connect, ceiling * (0.5 + Math.random() * 0.5));
    };
    const connect = async () => {
      retry = undefined;
      let url: string | null = null;
      try { url = await staffStockLiveUrl(); }
      catch (error) { console.error("Staff stock connection could not be issued", error); }
      if (stopped) return;
      if (!url) return reconnect();
      let ws: WebSocket;
      try { ws = new WebSocket(url); }
      catch { return reconnect(); }
      socket = ws;
      let openedAt = Infinity;
      ws.onopen = () => {
        openedAt = Date.now();
        everything = true;
        void drain();
      };
      ws.onmessage = ({ data }) => {
        try {
          const event = JSON.parse(data);
          if (event.type === "stock.changed" && Number.isSafeInteger(event.sizeId)) {
            sizes.add(event.sizeId);
            void drain();
          }
        } catch { /* Ignore frames outside the stock contract. */ }
      };
      ws.onclose = () => {
        if (socket !== ws) return;
        socket = undefined;
        if (Date.now() - openedAt >= 10_000) attempts = 0;
        reconnect();
      };
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return <StockView page={page} />;
}
