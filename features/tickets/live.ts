import type postgres from "postgres";

import type { Actor } from "./ticket-actions";

/** Opens-ready address of a Ticket's Conversation for one Staff member; see lib/gateway.ts. */
export type LiveConversationUrl = (ticketId: number, staffId: string) => Promise<string>;

/** Stores a storefront Notification for a Customer; see lib/gateway.ts. */
export type SendStorefrontNotification = (notification: {
  title: string;
  body: string;
  link: string;
  userIds: string[];
}) => Promise<void>;

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

export type OfflineNotice = { ok: true } | { ok: false; reason: "not-found" | "not-claimer" };

/**
 * A Staff reply the Customer was not connected to receive becomes a storefront Notification, not an
 * email. Only the Claimer, who is the one who can reply, may raise it.
 */
export async function notifyOfflineCustomer(
  reader: postgres.Sql,
  id: number,
  actor: Actor,
  storefrontTicketUrl: (id: number) => string,
  send: SendStorefrontNotification,
): Promise<OfflineNotice> {
  const [t] = await reader<{ subject: string; customer_id: string; claimed_by_id: string | null }[]>`
    select subject, customer_id, claimed_by_id from tickets where id = ${id}`;

  if (!t) return { ok: false, reason: "not-found" };
  if (t.claimed_by_id !== actor.id) return { ok: false, reason: "not-claimer" };

  await send({
    title: `New reply on TKT-${id}`,
    body: `${actor.name} replied to "${t.subject}".`,
    link: storefrontTicketUrl(id),
    userIds: [t.customer_id],
  });

  return { ok: true };
}
