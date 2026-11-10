"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { staffOrdersLiveUrl } from "./live-actions";

/** Order and Return pages catch up on connect and refresh only when ecommerce signals a change. */
export function BackgroundRefresh() {
  const router = useRouter();
  const refresh = useRef(router.refresh);
  useEffect(() => { refresh.current = router.refresh; });

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const reconnect = () => {
      if (stopped) return;
      const ceiling = Math.min(30_000, 1_000 * 2 ** Math.min(attempts++, 5));
      retry = setTimeout(connect, ceiling * (0.5 + Math.random() * 0.5));
    };
    const connect = async () => {
      retry = undefined;
      let url: string | null = null;
      try { url = await staffOrdersLiveUrl(); }
      catch (error) { console.error("Staff Orders connection could not be issued", error); }
      if (stopped) return;
      if (!url) return reconnect();
      let ws: WebSocket;
      try { ws = new WebSocket(url); }
      catch { return reconnect(); }
      socket = ws;
      let openedAt = Infinity;
      ws.onopen = () => {
        openedAt = Date.now();
        refresh.current();
      };
      ws.onmessage = ({ data }) => {
        try {
          if (JSON.parse(data).type === "orders.changed") refresh.current();
        } catch { /* Ignore frames outside the Orders signal contract. */ }
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
  return null;
}
