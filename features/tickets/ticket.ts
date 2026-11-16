import type postgres from "postgres";

import { PAID_OR_FULFILLED, stageOf, type Stage } from "@/features/customer-profiles/rules";

import type { FileStorage } from "./attachments";
import { DEFAULT_HISTORY, type ServiceLevel } from "./service-level";
import { withServiceLevels, type ServiceLevels } from "./service-level-store";
import type { HoldReason, TicketHold, TicketPriority, TicketStatus } from "./tickets";

export interface TicketMessage {
  id: number;
  sender: "customer" | "staff";
  /** The Customer's first name, or the Claimer's name for Staff ("Staff" while Unclaimed). */
  senderName: string;
  body: string;
  /** The Message carries an image, PDF or video. */
  hasAttachment: boolean;
  /** An Internal note: Staff-only, written by `senderName`, never a Staff reply. */
  internal?: boolean;
  /** A note shown before the server has confirmed it. */
  sending?: boolean;
  /** The file-storage id of the image, when it was stored there; old storefront images have none. */
  fileId?: string | null;
  /** A short-lived address to show the image from; null when there is none to show. */
  attachmentUrl?: string | null;
  /** The attachment's content type and file name, when file-storage could say; they decide how it is shown. */
  attachmentType?: string | null;
  attachmentName?: string | null;
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
  /** Set while the Ticket is On hold; null otherwise. */
  hold: TicketHold | null;
  /** The countdown to the first reply or resolve target, taken from the pair in force when it was opened. */
  serviceLevel: ServiceLevel;
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
  levels: ServiceLevels = { history: DEFAULT_HISTORY },
): Promise<TicketDetail | null> {
  const [t] = await sql<Record<string, unknown>[]>`
    select t.id, t.subject, t.status, t.priority, t.created_at, t.claimed_by_name, t.claimed_by_id, t.order_id, t.hold_reason, t.hold_note, t.hold_until, t.resolved_at, t.held_seconds, t.hold_started_at,
      c.id as customer_id, c.full_name, c.first_name
    from tickets t
    join customers c on c.id = t.customer_id
    where t.id = ${id}`;

  if (!t) return null;

  const customerId = t.customer_id as string;
  const claimerName = (t.claimed_by_name as string | null) ?? null;
  const customerFirstName = (t.first_name as string) || (t.full_name as string);

  const messages = await sql<Record<string, unknown>[]>`
    select id, sender, body, file_id, attachment_pathname, internal, author_name, created_at
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

  const serviceLevel = (
    await withServiceLevels(
      levels,
      [
        {
          id,
          createdAt: t.created_at as Date,
          input: {
            status: t.status as TicketStatus,
            resolvedAt: (t.resolved_at as Date | null) ?? null,
            heldSeconds: t.held_seconds as number,
            holdStartedAt: (t.hold_started_at as Date | null) ?? null,
            // An Internal note is not a Message to the Customer, so it never starts, stops or restarts a clock.
            messages: messages
              .filter((m) => !m.internal)
              .map((m) => ({ sender: m.sender as "customer" | "staff", at: m.created_at as Date })),
          },
        },
      ],
      now,
    )
  ).get(id)!;

  return {
    id: t.id as number,
    subject: t.subject as string,
    status: t.status as TicketStatus,
    priority: t.priority as TicketPriority,
    openedAt: t.created_at as Date,
    claimerName,
    claimerId: (t.claimed_by_id as string | null) ?? null,
    hold:
      t.status === "on_hold" && t.hold_reason && t.hold_until
        ? {
            reason: t.hold_reason as HoldReason,
            note: (t.hold_note as string | null) ?? null,
            until: t.hold_until as Date,
          }
        : null,
    serviceLevel,
    messages: messages.map((m) => ({
      id: m.id as number,
      sender: m.sender as "customer" | "staff",
      internal: m.internal === true,
      senderName:
        m.sender === "customer" ? customerFirstName : m.internal ? ((m.author_name as string | null) ?? "Staff") : (claimerName ?? "Staff"),
      body: m.body as string,
      hasAttachment: m.file_id !== null || m.attachment_pathname !== null,
      fileId: (m.file_id as string | null) ?? null,
      attachmentUrl: null,
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
export async function loadTicket(
  connect: () => postgres.Sql,
  id: number,
  storage?: FileStorage,
  levels?: ServiceLevels,
): Promise<TicketResult> {
  try {
    const ticket = await getTicket(connect(), id, new Date(), levels);
    if (ticket && storage) await addImageAddresses(ticket, storage);

    return { ok: true, ticket };
  } catch (error) {
    console.error("Ticket could not be read from the ecommerce database", error);
    return { ok: false };
  }
}

/** A Message whose address cannot be fetched still shows; only its attachment is missing. */
async function addImageAddresses(ticket: TicketDetail, storage: FileStorage) {
  await Promise.all(
    ticket.messages.map(async (m) => {
      if (!m.fileId) return;

      try {
        if (storage.viewFile) {
          const file = await storage.viewFile(m.fileId);
          m.attachmentUrl = file.url;
          m.attachmentType = file.contentType;
          m.attachmentName = file.filename;
        } else m.attachmentUrl = await storage.viewUrl(m.fileId);
      } catch (error) {
        console.error(`The image on Ticket TKT-${ticket.id} Message ${m.id} could not be reached`, error);
      }
    }),
  );
}
