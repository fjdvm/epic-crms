import type { TicketStatus } from "@/features/tickets/tickets";
import type postgres from "postgres";
import { shopRole } from "@/lib/portal/roles";
import { questionKindOf } from "./question-kind";

export function mayReadResults(role: string) {
  return ["manager", "admin", "ceo"].includes(shopRole(role) ?? "");
}
export function weekStart(now: Date) {
  const local = new Date(now.getTime() + 8 * 3600000);
  local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - 8 * 3600000);
}
export interface StoredMessage {
  id: number;
  chat_id: number;
  sender: string;
  body: string;
  outcome: string | null;
  sent_to_model: string | null;
  created_at: Date;
  ticket_id: number | null;
}
export function resultsOf(messages: StoredMessage[], now: Date) {
  const start = weekStart(now).getTime(),
    previous = start - 7 * 86400000;
  const current = messages.filter(
    (m) => +m.created_at >= start && +m.created_at <= +now,
  );
  const questions = current.filter((m) => m.sender === "customer");
  const kinds = new Map<string, number>();
  const answeredByKind: Record<string, number> = {};
  const sorted = [...current].sort((a, b) => a.id - b.id);
  sorted.forEach((q, i) => {
    if (q.sender !== "customer") return;
    const kind = questionKindOf(q.body) ?? "unrecognised";
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    const reply = sorted.slice(i + 1).find((m) => m.chat_id === q.chat_id);
    if (reply?.sender === "assistant" && reply.outcome === "answered")
      answeredByKind[kind] = (answeredByKind[kind] ?? 0) + 1;
  });
  return {
    questions: questions.length,
    lastWeek: messages.filter(
      (m) =>
        m.sender === "customer" &&
        +m.created_at >= previous &&
        +m.created_at < start,
    ).length,
    answered: current.filter(
      (m) =>
        m.sender === "assistant" &&
        m.outcome === "answered" &&
        m.ticket_id === null,
    ).length,
    kinds: [...kinds].sort((a, b) => b[1] - a[1]),
    answeredByKind,
  };
}
export async function handoffs(db: postgres.Sql, ticketId?: number) {
  return db<
    {
      ticket_id: number;
      reason: string;
      summary: string;
      sent_source: string;
      sent_to_model: string | null;
      sent_at: Date;
      subject: string;
      customer_name: string;
      order_id: number | null;
      claimed_by_name: string | null;
      status: TicketStatus;
    }[]
  >`
    select h.ticket_id, h.reason, h.sent_summary as summary, h.sent_source, h.sent_to_model, h.sent_at,
      t.subject, c.full_name as customer_name, h.order_id, t.claimed_by_name, t.status
    from assistant_handoffs h join tickets t on t.id = h.ticket_id
    join customers c on c.id = t.customer_id
    where h.status = 'sent' ${ticketId === undefined ? db`` : db`and h.ticket_id = ${ticketId}`}
    order by h.sent_at asc`;
}
export async function chatForTicket(db: postgres.Sql, ticketId: number) {
  return db<StoredMessage[]>`select m.*, c.ticket_id from assistant_messages m
    join assistant_chats c on c.id = m.chat_id where c.ticket_id = ${ticketId} order by m.id`;
}
export async function loadResults(
  db: postgres.Sql,
  crms: postgres.Sql,
  now = new Date(),
) {
  const since = new Date(+weekStart(now) - 7 * 86400000);
  const messages = await db<
    StoredMessage[]
  >`select m.*, c.ticket_id from assistant_messages m
    join assistant_chats c on c.id = m.chat_id where m.created_at >= ${since} and m.created_at <= ${now}`;
  const [handoff] = await db<
    { total: number }[]
  >`select count(*)::int as total from assistant_handoffs
    where status = 'sent' and sent_at >= ${weekStart(now)} and sent_at <= ${now}`;
  const flags = await crms<
    {
      message_id: number;
      ticket_id: number;
      reason: string;
      staff_name: string;
      answer: string;
      created_at: Date;
    }[]
  >`
    select * from crms.assistant_answer_flags where created_at >= ${weekStart(now)} and created_at <= ${now} order by created_at desc`;
  return { ...resultsOf(messages, now), handedOff: handoff.total, flags };
}
/** Today's counts for the tab's stat cards, from stored chats only (Manila day). */
export function dayStart(now: Date) {
  const local = new Date(now.getTime() + 8 * 3600000);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - 8 * 3600000);
}
export async function todaysCounts(db: postgres.Sql, now = new Date()) {
  const since = dayStart(now);
  const [row] = await db<{ questions: number; answered: number }[]>`
    select count(*) filter (where m.sender = 'customer')::int as questions,
      count(*) filter (where m.sender = 'assistant' and m.outcome = 'answered' and c.ticket_id is null)::int as answered
    from assistant_messages m join assistant_chats c on c.id = m.chat_id
    where m.created_at >= ${since} and m.created_at <= ${now}`;
  return row;
}
