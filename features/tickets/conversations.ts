import type postgres from "postgres";

import { formatDate } from "@/features/customer-profiles/format";

import type { FileStorage } from "./attachments";
import { loadTicket, type TicketDetail } from "./ticket";

export interface ConversationRow {
  /** The Ticket number is this id, written TKT-<id>. */
  ticketId: number;
  customerName: string;
  /** The last Message's text, "Sent a photo" for an image alone, or the subject before any Message. */
  preview: string;
  lastActivity: Date;
}

/** The chats of the Tickets this Staff member Claimed, newest activity first. A chat is a Ticket's Conversation; there is none without a Ticket. */
export async function listConversations(sql: postgres.Sql, viewerId: string): Promise<ConversationRow[]> {
  const rows = await sql<Record<string, unknown>[]>`
    select
      t.id,
      t.subject,
      c.full_name as customer_name,
      m.body,
      (m.file_id is not null or m.attachment_pathname is not null) as has_attachment,
      coalesce(m.created_at, t.created_at) as last_activity
    from tickets t
    join customers c on c.id = t.customer_id
    left join lateral (
      select body, file_id, attachment_pathname, created_at from ticket_messages
      where ticket_id = t.id
      order by created_at desc, id desc
      limit 1
    ) m on true
    where t.claimed_by_id = ${viewerId}
    order by last_activity desc, t.id desc`;

  return rows.map((r) => ({
    ticketId: r.id as number,
    customerName: r.customer_name as string,
    preview:
      r.body === null
        ? (r.subject as string)
        : (r.body as string).trim() || (r.has_attachment ? "Sent a photo" : (r.subject as string)),
    lastActivity: r.last_activity as Date,
  }));
}

/** "5m", "3h", "Yesterday", then the date, as the inbox shows when a chat last moved. */
export function inboxTime(at: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 48 * 60) return "Yesterday";

  return formatDate(at);
}

export interface Conversations {
  chats: ConversationRow[];
  /** The chat open in the middle column: the one asked for, else the newest; null when there are no chats. */
  selected: TicketDetail | null;
}

export type ConversationsResult = { ok: true; conversations: Conversations } | { ok: false };

/**
 * The inbox and the open chat. An unreachable database becomes `{ ok: false }` so the page can say
 * so in place instead of crashing into the framework's generic error page.
 */
export async function loadConversations(
  connect: () => postgres.Sql,
  viewerId: string,
  selectedId?: number,
  storage?: FileStorage,
): Promise<ConversationsResult> {
  try {
    const chats = await listConversations(connect(), viewerId);
    const id = chats.find((c) => c.ticketId === selectedId)?.ticketId ?? chats[0]?.ticketId;
    if (id === undefined) return { ok: true, conversations: { chats, selected: null } };

    const result = await loadTicket(connect, id, storage);
    if (!result.ok) return { ok: false };

    return { ok: true, conversations: { chats, selected: result.ticket } };
  } catch (error) {
    console.error("Conversations could not read the ecommerce database", error);
    return { ok: false };
  }
}
