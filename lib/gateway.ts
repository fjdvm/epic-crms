import { createHmac } from "node:crypto";

import type { WriteAuditEvent } from "@/features/feedback/analysis";
import type { AuditLog, MarketingMailer, Subscriber } from "@/features/marketing/announcements";
import type { ImageStore } from "@/features/marketing/image-limits";
import type { FileStorage } from "@/features/tickets/attachments";
import type { LiveConversationUrl } from "@/features/tickets/live";
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

/** Posts one Audit Event through the api-gateway to audit-logs, as the "crms" Caller. Callers decide whether a failure matters. */
async function postAuditEvent(event: object): Promise<void> {
  const { base, key } = gateway();

  const response = await fetch(`${base}/audit/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) throw new Error(`The gateway refused the audit event: ${response.status}`);
}

export const writeAuditEvent: WriteAuditEvent = postAuditEvent;

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

/** Calls file-storage through the gateway as the "crms" Caller, which the gateway maps to the CRMS Client System. */
async function storage<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { base, key } = gateway();

  const response = await fetch(`${base}/files${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });

  if (!response.ok) throw new Error(`file-storage refused ${init.method ?? "GET"} ${path}: ${response.status}`);

  return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Images are Private and Permanent Files, Linked to the Message they belong to. */
export const gatewayFileStorage: FileStorage = {
  async upload({ filename, contentType, bytes }) {
    const pending = await storage<{ id: string; uploadUrl: string }>("", {
      method: "POST",
      body: JSON.stringify({
        filename,
        contentType,
        size: bytes.length,
        visibility: "private",
        retentionType: "permanent",
      }),
    });

    // The signed address is file-storage's own, so it takes no gateway key.
    const put = await fetch(pending.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: bytes as BodyInit,
    });
    if (!put.ok) throw new Error(`The image upload was refused: ${put.status}`);

    await storage(`/${pending.id}/confirm`, { method: "POST" });

    return pending.id;
  },

  async linkToMessage(fileId, messageId) {
    await storage(`/${fileId}/links`, {
      method: "POST",
      body: JSON.stringify({
        system: "CRMS",
        entityType: "ticket-message",
        entityId: String(messageId),
        role: "attachment",
      }),
    });
  },

  async viewUrl(fileId) {
    return (await storage<{ url: string }>(`/${fileId}`)).url;
  },

  async remove(fileId) {
    await storage(`/${fileId}`, { method: "DELETE" });
  },
};

/**
 * Announcement images are Public and Permanent Files, so a recipient's mail app can fetch them long
 * after the email is sent. A Draft's images are not Linked: file-storage's Links name records, and
 * an Announcement not yet saved has none.
 */
export const gatewayImageStore: ImageStore = {
  async store({ contentType, bytes }) {
    const pending = await storage<{ id: string; uploadUrl: string }>("", {
      method: "POST",
      body: JSON.stringify({
        filename: `announcement-${Date.now()}.jpg`,
        contentType,
        size: bytes.length,
        visibility: "public",
        retentionType: "permanent",
      }),
    });

    // The signed address is file-storage's own, so it takes no gateway key.
    const put = await fetch(pending.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes as BodyInit });
    if (!put.ok) throw new Error(`The image upload was refused: ${put.status}`);

    await storage(`/${pending.id}/confirm`, { method: "POST" });

    const { url } = await storage<{ url: string }>(`/${pending.id}`);
    if (!url.startsWith("https://")) throw new Error("file-storage gave an image address that is not HTTPS");

    return url;
  },
};

/** Announcement actions as Audit Events: CRMS, Marketing Module, acted by a Staff member. */
export const gatewayAuditLog: AuditLog = {
  record: (event) =>
    postAuditEvent({
      source: "CRMS",
      module: "Marketing",
      action: event.action,
      outcome: "success",
      actor: { type: "staff", id: event.actor.id, display_name: event.actor.name },
      target: { type: "announcement", id: event.announcement.id, display_name: event.announcement.title },
      description: event.description,
      ...(event.subscribers === undefined ? {} : { metadata: { subscribers: event.subscribers } }),
      occurred_at: event.occurredAt.toISOString(),
    }),
};

/**
 * The link in a Marketing Email that sets one Customer's Marketing opt-in to no. The storefront verifies the
 * same token, `<base64url id>.<base64url HMAC-SHA256 of the id>`, signed with the secret both share.
 */
export function unsubscribeUrl(customerId: string): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  const site = process.env.CREOMS_STOREFRONT_URL;

  if (!secret || !site) throw new Error("UNSUBSCRIBE_SECRET and CREOMS_STOREFRONT_URL must be set; see .env.example");

  const signature = createHmac("sha256", secret).update(customerId).digest("base64url");

  return `${site.replace(/\/$/, "")}/unsubscribe?token=${Buffer.from(customerId).toString("base64url")}.${signature}`;
}

/** How many Marketing Emails are in flight to the gateway at once within a batch. */
const MAX_CONCURRENT_EMAILS = 10;

/**
 * Hands a batch to the notifications service as the CRMS Caller. Each Subscriber gets their own Email, because
 * each carries their own Unsubscribe link, and the Email asserts that its recipient is a Subscriber.
 */
export const gatewayMarketingMailer: MarketingMailer = {
  async sendBatch(mail, to) {
    const { base, key } = gateway();
    const handedOver: Subscriber[] = [];

    for (let i = 0; i < to.length; i += MAX_CONCURRENT_EMAILS) {
      const settled = await Promise.allSettled(
        to.slice(i, i + MAX_CONCURRENT_EMAILS).map(async (subscriber) => {
          const response = await fetch(`${base}/notifications/emails/marketing`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              to: subscriber.email,
              app: "CRMS",
              subscriberConsent: true,
              title: mail.title,
              body: mail.description,
              images: mail.images,
              unsubscribeUrl: unsubscribeUrl(subscriber.customerId),
            }),
            signal: AbortSignal.timeout(15_000),
          });

          if (!response.ok) throw new Error(`The gateway refused a Marketing Email: ${response.status}`);

          return subscriber;
        }),
      );

      for (const result of settled) {
        if (result.status === "fulfilled") handedOver.push(result.value);
        else console.error("A Marketing Email could not be handed over", result.reason);
      }
    }

    return handedOver;
  },
};
