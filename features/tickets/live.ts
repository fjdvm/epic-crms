/** Opens-ready address of a Ticket's Conversation for one Staff member; see lib/gateway.ts. */
export type LiveConversationUrl = (ticketId: number, staffId: string) => Promise<string>;

/** What the relay sends the browser; the only frames CREOMS reads. */
export type LiveEvent =
  | { type: "message"; id: string; from: { userId: string; role: "Customer" | "Staff" }; text: string; sentAt: string }
  | { type: "message.delivered"; id: string; delivered: number }
  | { type: "presence"; event: "connected" | "disconnected"; userId: string; role: "Customer" | "Staff" }
  | { type: "error"; code: string; message: string; id?: string };

/** An open line into one Ticket's Conversation. */
export interface LiveConnection {
  send(frame: { type: "message"; id: string; text: string }): void;
  close(): void;
}

/**
 * The Live ticket boundary: opens the line and reports what arrives. `onClose` fires when the line
 * drops, so the caller can reconnect. Tests replace this with a fake; the real one is live-socket.ts.
 */
export type ConnectLive = (
  ticketId: number,
  handlers: { onOpen(): void; onEvent(event: LiveEvent): void; onClose(): void },
) => LiveConnection;
