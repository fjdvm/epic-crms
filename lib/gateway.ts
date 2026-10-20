import type { LiveConversationUrl, SendStorefrontNotification } from "@/features/tickets/live";
import type { SendAppEmail } from "@/features/tickets/ticket-actions";

/** Queues an App email through the api-gateway's notifications service, as the "crms" Caller. */
export const sendAppEmail: SendAppEmail = async (email) => {
  const { base, key } = gateway();

  const response = await fetch(`${base}/notifications/emails/app`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...email, app: "crms" }),
  });

  if (!response.ok) throw new Error(`The gateway refused the email: ${response.status}`);
};

/** Where the Customer reviews a Ticket in the storefront. */
export function storefrontTicketUrl(id: number): string {
  const base = process.env.CREOMS_STOREFRONT_URL;

  if (!base) throw new Error("CREOMS_STOREFRONT_URL is not set; see .env.example");

  return `${base.replace(/\/$/, "")}/support/${id}`;
}

function gateway(): { base: string; key: string } {
  const base = process.env.CREOMS_GATEWAY_URL;
  const key = process.env.CREOMS_GATEWAY_CALLER_KEY;

  if (!base || !key)
    throw new Error("CREOMS_GATEWAY_URL and CREOMS_GATEWAY_CALLER_KEY must be set; see .env.example");

  return { base: base.replace(/\/$/, ""), key };
}

/**
 * The address a Staff member's browser opens to join a Ticket's Conversation. The Live ticket in it
 * names the Staff member, the Ticket and the Staff role, and expires within about a minute.
 */
export const liveConversationUrl: LiveConversationUrl = async (ticketId, staffId) => {
  const { base, key } = gateway();

  const response = await fetch(`${base}/live-tickets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ userId: staffId, ticketId: String(ticketId), role: "Staff" }),
  });

  if (!response.ok) throw new Error(`The gateway refused a Live ticket: ${response.status}`);

  const { ticket } = (await response.json()) as { ticket: string };

  return `${base.replace(/^http/, "ws")}/notifications/conversations/${ticketId}/live?ticket=${encodeURIComponent(ticket)}`;
};

/** Stores a Notification for a Customer in the storefront, as the "crms" Caller. */
export const sendStorefrontNotification: SendStorefrontNotification = async (notification) => {
  const { base, key } = gateway();

  const response = await fetch(`${base}/notifications/notifications`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...notification,
      type: "ticket.reply",
      sendingApp: "crms",
      targetApp: process.env.CREOMS_STOREFRONT_APP ?? "ecom",
    }),
  });

  if (!response.ok) throw new Error(`The gateway refused the Notification: ${response.status}`);
};
