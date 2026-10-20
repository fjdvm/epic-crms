import type postgres from "postgres";

import { PAID_OR_FULFILLED, stageOf, type Stage } from "@/features/customer-profiles/rules";

import type { TicketPriority, TicketStatus } from "./tickets";

export interface TicketMessage {
  id: number;
  sender: "customer" | "staff";
  /** The Customer's first name, or the Claimer's name for Staff ("Staff" while Unclaimed). */
  senderName: string;
  body: string;
  /** The Message carries an image. */
  hasAttachment: boolean;
  createdAt: Date;
}

export interface TicketOrder {
  id: number;
  /** Centavos; subtotal plus Delivery fee. */
  total: number;
  status: string;
  lines: { product: string; quantity: number }[];
}

export interface TicketCustomer {
  id: string;
  name: string;
  stage: Stage;
  orders: number;
  /** Centavos. */
  totalSpent: number;
}

export interface TicketDetail {
  /** The Ticket number is this id, written TKT-<id>. */
  id: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  openedAt: Date;
  /** The Claimer's name; null while Unclaimed. */
  claimerName: string | null;
  /** The Claimer's opaque Staff id; null while Unclaimed. */
  claimerId: string | null;
  /** Oldest first. */
  messages: TicketMessage[];
  /** The Linked order; null when the Ticket has none. */
  order: TicketOrder | null;
  customer: TicketCustomer;
}

export type TicketResult = { ok: true; ticket: TicketDetail | null } | { ok: false };

/** One Ticket with its Conversation, Linked order and Customer, or null if there is no such Ticket. */
export async function getTicket(
  sql: postgres.Sql,
  id: number,
  now: Date = new Date(),
): Promise<TicketDetail | null> {
  const [t] = await sql<Record<string, unknown>[]>`
    select t.id, t.subject, t.status, t.priority, t.created_at, t.claimed_by_name, t.claimed_by_id, t.order_id,
      c.id as customer_id, c.full_name, c.first_name
    from tickets t
    join customers c on c.id = t.customer_id
    where t.id = ${id}`;

  if (!t) return null;

  const customerId = t.customer_id as string;
  const claimerName = (t.claimed_by_name as string | null) ?? null;
  const customerFirstName = (t.first_name as string) || (t.full_name as string);

  const messages = await sql<Record<string, unknown>[]>`
    select id, sender, body, file_id, attachment_pathname, created_at
    from ticket_messages
    where ticket_id = ${id}
    order by created_at, id`;

  const [totals] = await sql<Record<string, unknown>[]>`
    select
      count(*)::int as orders,
      coalesce(sum(case when status = any(${PAID_OR_FULFILLED})
                        then subtotal_in_centavos + coalesce(delivery_fee_in_centavos, 0) end), 0)::bigint as total_spent,
      (count(*) filter (where status <> 'cancelled'))::int as stage_orders,
      max(created_at) filter (where status <> 'cancelled') as last_order
    from orders where customer_id = ${customerId}`;

  let order: TicketOrder | null = null;

  if (t.order_id !== null) {
    const [o] = await sql<Record<string, unknown>[]>`
      select id, status, subtotal_in_centavos, delivery_fee_in_centavos from orders where id = ${t.order_id as number}`;
    const lines = await sql<Record<string, unknown>[]>`
      select product_name, quantity from order_lines where order_id = ${t.order_id as number} order by id`;

    order = {
      id: o.id as number,
      total: (o.subtotal_in_centavos as number) + ((o.delivery_fee_in_centavos as number | null) ?? 0),
      status: o.status as string,
      lines: lines.map((l) => ({
        product: l.product_name as string,
        quantity: l.quantity as number,
      })),
    };
  }

  return {
    id: t.id as number,
    subject: t.subject as string,
    status: t.status as TicketStatus,
    priority: t.priority as TicketPriority,
    openedAt: t.created_at as Date,
    claimerName,
    claimerId: (t.claimed_by_id as string | null) ?? null,
    messages: messages.map((m) => ({
      id: m.id as number,
      sender: m.sender as "customer" | "staff",
      senderName: m.sender === "customer" ? customerFirstName : (claimerName ?? "Staff"),
      body: m.body as string,
      hasAttachment: m.file_id !== null || m.attachment_pathname !== null,
      createdAt: m.created_at as Date,
    })),
    order,
    customer: {
      id: customerId,
      name: t.full_name as string,
      stage: stageOf(
        {
          orders: totals.stage_orders as number,
          lastOrder: (totals.last_order as Date | null) ?? null,
        },
        now,
      ),
      orders: totals.orders as number,
      totalSpent: Number(totals.total_spent),
    },
  };
}

/**
 * Like getTicket, but an unreachable database becomes `{ ok: false }` so the page can say so in
 * place instead of crashing into the framework's generic error page.
 */
export async function loadTicket(connect: () => postgres.Sql, id: number): Promise<TicketResult> {
  try {
    return { ok: true, ticket: await getTicket(connect(), id) };
  } catch (error) {
    console.error("Ticket could not be read from the ecommerce database", error);
    return { ok: false };
  }
}
