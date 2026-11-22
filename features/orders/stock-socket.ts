import { refetchStock, refetchStockSize, staffStockLiveUrl } from "./stock-live-actions";
import { withSize, type StockPage } from "./stock";

/** The notification service sends ids as strings; older frames and tests send numbers. Anything else is not a Size. */
export function sizeIdOf(value: unknown): number | null {
  const id = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export interface LiveStockStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): StockPage;
  /** The page the server rendered changed (a refresh or a new search): start again from it, without telling listeners mid-render. */
  rebase(page: StockPage): void;
  readonly base: StockPage;
}

/**
 * Products & Stocks, kept current by the Staff stock channel. The connection lives while someone subscribes:
 * the first subscriber opens it, the last one leaving closes it. A Size-ID event refetches that Size; opening
 * the page, and every reconnect, refetch everything. Nothing runs on a timer, focus or visibility: the only
 * timer is the reconnect back-off, which makes no data request.
 */
export function createLiveStock(initial: StockPage): LiveStockStore {
  let base = initial;
  let page = initial;
  const listeners = new Set<() => void>();
  const set = (change: (current: StockPage) => StockPage) => {
    page = change(page);
    for (const listener of listeners) listener();
  };

  let stop: (() => void) | null = null;

  const start = () => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let connected = false;

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
              if (result.ok && !stopped) set(() => result.page);
            } else {
              const [id] = sizes;
              sizes.delete(id);
              const result = await refetchStockSize(id);
              if (result.ok && !stopped) set((current) => withSize(current, id, result.row));
              // Without the product feed one Size cannot be built, so catch up with a single full refetch.
              else if (!result.ok) everything = true;
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
        // The first connection follows the refresh made on open; every reconnect catches up on what it missed.
        if (connected) everything = true;
        connected = true;
        void drain();
      };
      ws.onmessage = ({ data }) => {
        try {
          const event = JSON.parse(data);
          const id = event?.type === "stock.changed" ? sizeIdOf(event.sizeId) : null;
          if (id !== null) {
            sizes.add(id);
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

    // Opening the page is a user action: bring CREOMS's copy up to date once, quietly. A failure changes nothing on screen.
    everything = true;
    void drain();
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onclose = null;
        socket.close();
      }
    };
  };

  return {
    get base() { return base; },
    subscribe(listener) {
      listeners.add(listener);
      if (!stop) stop = start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && stop) { stop(); stop = null; }
      };
    },
    getSnapshot: () => page,
    rebase(next) { base = next; page = next; },
  };
}
