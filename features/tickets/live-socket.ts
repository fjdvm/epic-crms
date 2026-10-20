"use client";

import { liveUrl } from "./actions";
import type { ConnectLive, LiveEvent } from "./live";

/** The real Live ticket boundary: asks the server for a Live ticket, then opens the gateway's WebSocket. */
export const connectLive: ConnectLive = (ticketId, { onOpen, onEvent, onClose }) => {
  let socket: WebSocket | undefined;
  let closed = false;

  void liveUrl(ticketId)
    .then((url) => {
      if (closed) return;
      if (!url) return onClose();

      socket = new WebSocket(url);
      socket.onopen = onOpen;
      socket.onclose = onClose;
      socket.onmessage = (e) => {
        try {
          onEvent(JSON.parse(String(e.data)) as LiveEvent);
        } catch {
          // A frame CREOMS cannot read is ignored; the database stays the source of truth.
        }
      };
    })
    .catch(() => onClose());

  return {
    send(frame) {
      if (socket?.readyState !== WebSocket.OPEN) throw new Error("The live line is not open");
      socket.send(JSON.stringify(frame));
    },
    close() {
      closed = true;
      socket?.close();
    },
  };
};
