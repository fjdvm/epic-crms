import type postgres from "postgres";

import {
  FEEDBACK_MODULE, FULFILMENT_MODULE, ORDERS_MODULE, PAYMENTS_MODULE, RETURNS_MODULE, TICKETS_MODULE,
} from "@/lib/portal/config";

/** Tickets Staff have not answered within this long are Overdue. */
const OVERDUE_AFTER_HOURS = 24;

/** One Needs attention queue: how much work waits, and since when the oldest of it has. */
export type Queue<Extra = object> = ({ ok: true; count: number; oldest: Date | null } & Extra) | { ok: false };

export interface Attention {
  paymentProofs?: Queue;
  deliveryFees?: Queue;
  ordersToPack?: Queue;
  /** Centavos still out with couriers. */
  codToCollect?: Queue<{ centavos: number }>;
  openTickets?: Queue<{ overdue: number }>;
  returns?: Queue;
  lowFeedback?: Queue;
}

interface Row { count: number; oldest: Date | null }

type Read<Extra> = (sql: postgres.Sql, now: Date) => Promise<{ count: number; oldest: Date | null } & Extra>;

/** Every queue is read live, on its own, so one failing leaves the rest standing. */
const queues: { key: keyof Attention; module: string; read: Read<object> }[] = [
  {
    key: "paymentProofs", module: PAYMENTS_MODULE,
    read: async (sql) => one(sql<Row[]>`
      select count(*)::int as count, min(payment_proof_submitted_at) as oldest from public.orders
      where payment_method = 'gcash' and status = 'awaiting payment' and payment_proof_submitted_at is not null`),
  },
  {
    key: "deliveryFees", module: ORDERS_MODULE,
    read: async (sql) => one(sql<Row[]>`
      select count(*)::int as count, min(created_at) as oldest from public.orders
      where status = 'placed' and fulfillment_method = 'delivery'`),
  },
  {
    key: "ordersToPack", module: FULFILMENT_MODULE,
    read: async (sql) => one(sql<Row[]>`
      select count(*)::int as count, min(created_at) as oldest from public.orders
      where status = 'paid' or (status = 'confirmed' and payment_method = 'cash-on-delivery')`),
  },
  {
    key: "codToCollect", module: FULFILMENT_MODULE,
    read: async (sql) => {
      const [row] = await sql<(Row & { centavos: string })[]>`
        select count(*)::int as count, min(created_at) as oldest,
          coalesce(sum(subtotal_in_centavos + coalesce(delivery_fee_in_centavos, 0)), 0)::bigint as centavos
        from public.orders
        where payment_method = 'cash-on-delivery' and status in ('confirmed', 'preparing', 'dispatched')`;

      return { count: row.count, oldest: row.oldest, centavos: Number(row.centavos) };
    },
  },
  {
    key: "openTickets", module: TICKETS_MODULE,
    read: async (sql, now) => {
      const overdueBefore = new Date(now.getTime() - OVERDUE_AFTER_HOURS * 60 * 60 * 1000);
      // As the Tickets page: Unclaimed Open Tickets. The oldest waiting is the longest unanswered by Staff.
      const [row] = await sql<(Row & { overdue: number })[]>`
        select count(*)::int as count,
          (count(*) filter (where from_customer and last_activity < ${overdueBefore}))::int as overdue,
          min(last_activity) filter (where from_customer) as oldest
        from (
          select coalesce(m.created_at, t.created_at) as last_activity,
            coalesce(m.sender, 'customer') = 'customer' as from_customer
          from public.tickets t
          left join lateral (
            select sender, created_at from public.ticket_messages
            where ticket_id = t.id order by created_at desc, id desc limit 1
          ) m on true
          where t.status = 'open' and t.claimed_by_id is null
        ) open_tickets`;

      return row;
    },
  },
  {
    key: "returns", module: RETURNS_MODULE,
    read: async (sql) => one(sql<Row[]>`
      select count(*)::int as count, min(requested_at) as oldest from public.order_returns where status = 'requested'`),
  },
  {
    key: "lowFeedback", module: FEEDBACK_MODULE,
    read: async (sql) => one(sql<Row[]>`
      select count(*)::int as count, min(created_at) as oldest from public.order_feedback where rating <= 3`),
  },
];

async function one(rows: Promise<Row[]>): Promise<Row> {
  const [row] = await rows;

  return row;
}

export async function loadAttention(
  connect: () => postgres.Sql,
  { modules, now }: { modules: readonly string[]; now: Date },
): Promise<Attention> {
  const held = queues.filter(({ module }) => modules.includes(module));

  const results = await Promise.all(held.map(async ({ key, read }) => {
    try {
      return [key, { ok: true, ...(await read(connect(), now)) }] as const;
    } catch {
      return [key, { ok: false }] as const;
    }
  }));

  return Object.fromEntries(results) as Attention;
}
