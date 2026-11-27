import type postgres from "postgres";
import { customerNameSql } from "@/lib/deleted-customer";

import type { ShopRole } from "@/lib/portal/roles";
import { formatDate } from "@/features/customer-profiles/format";
import { searchParamsKey } from "@/lib/search-params-key";

import type { FileStorage } from "./attachments";
import { loadTicket, type TicketDetail } from "./ticket";
import { ticketSearch } from "./tickets";

/** The inbox tabs: the viewer's own chats, chats nobody has claimed, or every chat. */
export type ChatScope = "mine" | "unclaimed" | "all";

export const CHAT_SCOPES: ChatScope[] = ["mine", "unclaimed", "all"];

/**
 * The tabs a Role may open: Mine for Staff and Managers, Unclaimed for everyone with the Tickets Module, All
 * (Resolved and Closed too) for Managers (CEO and VP included) and Admin. The first one is the Role's default tab.
 */
export function scopesFor(role: ShopRole | null): ChatScope[] {
  switch (role) {
    case "staff":
      return ["mine", "unclaimed"];
    case "manager":
      return ["mine", "unclaimed", "all"];
    case "admin":
      return ["unclaimed", "all"];
    default:
      return ["unclaimed"];
  }
}

/** The tab asked for when the Role may open it, otherwise the Role's default; the page never trusts the address. */
export function allowedScope(role: ShopRole | null, asked: string | undefined): ChatScope {
  const allowed = scopesFor(role);

  return allowed.find((s) => s === asked) ?? allowed[0];
}

export interface ConversationRow {
  /** The Ticket number is this id, written TKT-<id>. */
  ticketId: number;
  customerName: string;
  /** The last Message's text, "Sent a photo" for an image alone, or the subject before any Message. */
  preview: string;
  lastActivity: Date;
}

/**
 * The chats of the Tickets this Staff member Claimed (or the Unclaimed ones; All adds Resolved and Closed too, but never a Ticket someone else Claimed), by `scope`, newest activity first, narrowed by the same search as
 * the Tickets list when one is given. A chat is a Ticket's Conversation; there is none without a Ticket.
 */
export async function listConversations(
  sql: postgres.Sql,
  viewerId: string,
  search?: string,
  scope: ChatScope = "mine",
): Promise<ConversationRow[]> {
  const owner =
    scope === "mine"
      ? sql`t.claimed_by_id = ${viewerId} and t.status in ('open', 'on_hold')`
      : scope === "unclaimed"
        ? sql`t.claimed_by_id is null and t.status in ('open', 'on_hold')`
        : sql`(t.claimed_by_id is null or t.claimed_by_id = ${viewerId})`;

  const rows = await sql<Record<string, unknown>[]>`
    select
      t.id,
      t.subject,
      ${sql.unsafe(customerNameSql('c'))} as customer_name,
      m.body,
      (m.file_id is not null or m.attachment_pathname is not null) as has_attachment,
      coalesce(m.created_at, t.created_at) as last_activity
    from tickets t
    join customers c on c.id = t.customer_id
    left join lateral (
      select body, file_id, attachment_pathname, created_at from ticket_messages
      where ticket_id = t.id and not internal
      order by created_at desc, id desc
      limit 1
    ) m on true
    where ${owner} and ${ticketSearch(sql, search)}
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

/** The Suspense key of the inbox: its tab and search reload it, opening a chat does not. */
export function inboxKey(raw: Record<string, string | string[] | undefined>): string {
  const { ticket: _ticket, ...inbox } = raw;

  return searchParamsKey(inbox);
}

/** The chat to open: the one asked for, else the newest. A Manager-level Role may open any Ticket by id, even one outside the list. */
export function openChatId(chats: ConversationRow[], asked: number | undefined, openAny: boolean): number | undefined {
  return chats.find((c) => c.ticketId === asked)?.ticketId ?? (openAny ? asked : undefined) ?? chats[0]?.ticketId;
}

function unreadable(error: unknown): { ok: false } {
  console.error("Conversations could not read the ecommerce database", error);

  return { ok: false };
}

/**
 * The inbox rows. An unreachable database becomes `{ ok: false }` so the page can say so in place instead of
 * crashing into the framework's generic error page.
 */
export async function loadChats(
  connect: () => postgres.Sql,
  viewerId: string,
  search?: string,
  scope: ChatScope = "mine",
): Promise<{ ok: true; chats: ConversationRow[] } | { ok: false }> {
  try {
    return { ok: true, chats: await listConversations(connect(), viewerId, search, scope) };
  } catch (error) {
    return unreadable(error);
  }
}

/** The open chat, loaded apart from the inbox so each can show on its own. Null when there is none to open. */
export async function loadOpenChat(
  connect: () => postgres.Sql,
  id: number | undefined,
  storage?: FileStorage,
): Promise<{ ok: true; selected: TicketDetail | null } | { ok: false }> {
  if (id === undefined) return { ok: true, selected: null };

  try {
    const result = await loadTicket(connect, id, storage);

    return result.ok ? { ok: true, selected: result.ticket } : { ok: false };
  } catch (error) {
    return unreadable(error);
  }
}

/** The inbox and the open chat together. */
export async function loadConversations(
  connect: () => postgres.Sql,
  viewerId: string,
  selectedId?: number,
  storage?: FileStorage,
  search?: string,
  scope: ChatScope = "mine",
  openAny = false,
): Promise<ConversationsResult> {
  const inbox = await loadChats(connect, viewerId, search, scope);
  if (!inbox.ok) return inbox;

  const chat = await loadOpenChat(connect, openChatId(inbox.chats, selectedId, openAny), storage);
  if (!chat.ok) return chat;

  return { ok: true, conversations: { chats: inbox.chats, selected: chat.selected } };
}
