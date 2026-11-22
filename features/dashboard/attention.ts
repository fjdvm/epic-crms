import type postgres from "postgres";

import {
  FEEDBACK_MODULE, FULFILMENT_MODULE, ORDERS_MODULE, PAYMENTS_MODULE, RETURNS_MODULE, TICKETS_MODULE,
} from "@/lib/portal/config";
import { MANAGER_AFTER_REJECTIONS } from "@/features/orders/payment-methods";
import { DEFAULT_HISTORY, firstReplyHoursSql, type TargetHistory } from "@/features/tickets/service-level";

/** One Needs attention queue: how much work waits, and since when the oldest of it has. */
export type Queue<Extra = object> = ({ ok: true; count: number; oldest: Date | null } & Extra) | { ok: false };

export interface Attention {
  paymentProofs?: Queue;
  deliveryFees?: Queue;
  /** Orders still unconfirmed past the Admin's limit. Nothing is cancelled for them. */
  overdueOrders?: Queue;
  /** Customers waiting for a person to approve or decline their request to cancel an Order. */
  cancelRequests?: Queue;
  /** Manager payment reviews (3 rejected proofs) still unsettled; Overdue ones stay here until a Manager acts. Managers only. */
  paymentReviews?: Queue<{ overdue: number }>;
  ordersToPack?: Queue;
  /** Centavos still out with couriers. */
  codToCollect?: Queue<{ centavos: number }>;
  openTickets?: Queue<{ overdue: number }>;
  returns?: Queue;
  lowFeedback?: Queue;
}

interface Row { count: number; oldest: Date | null }

/** Hours an Order may wait to be confirmed; the default is the Admin setting's default. */
export const DEFAULT_UNCONFIRMED_HOURS = 48;

type Read<Extra> = (sql: postgres.Sql, now: Date, history: TargetHistory, unconfirmedHours: number | null, reviewHours: number | null) => Promise<{ count: number; oldest: Date | null } & Extra>;

/** Every queue is read live, on its own, so one failing leaves the rest standing. */
const queues: { key: keyof Attention; module: string; managerOnly?: boolean; read: Read<object> }[] = [
  {
    key: "paymentProofs", module: PAYMENTS_MODULE,
    read: async (sql) => one(sql<Row[]>`
      select count(*)::int as count, min(payment_proof_submitted_at) as oldest from public.orders
      where payment_method in ('gcash', 'maya', 'bank-transfer') and status = 'awaiting payment'
        and payment_proof_submitted_at is not null and payment_proof_rejected_at is null`),
  },
  {
    key: "deliveryFees", module: ORDERS_MODULE,
    read: async (sql) => one(sql<Row[]>`
      select count(*)::int as count, min(created_at) as oldest from public.orders
      where status = 'placed' and fulfillment_method = 'delivery'`),
  },
  {
    key: "cancelRequests", module: ORDERS_MODULE,
    read: async (sql) => one(sql<Row[]>`
      select count(*)::int as count, min(created_at) as oldest from public.order_cancel_requests where status = 'waiting'`),
  },
  {
    key: "overdueOrders", module: ORDERS_MODULE,
    // Any payment method: `placed` is the one unconfirmed status. Confirming clears it.
    read: async (sql, now, _history, hours) => {
      if (hours === null) return { count: 0, oldest: null };

      return one(sql<Row[]>`
        select count(*)::int as count, min(created_at) as oldest from public.orders
        where status = 'placed' and created_at <= ${now}::timestamptz - ${hours}::int * interval '1 hour'`);
    },
  },
  {
    key: "paymentReviews", module: PAYMENTS_MODULE, managerOnly: true,
    // An Order awaiting payment after its third rejected proof. Nothing leaves this list but a Manager's decision.
    read: async (sql, now, _history, _hours, reviewHours) => {
      const [row] = await sql<(Row & { overdue: number })[]>`
        select count(*)::int as count, min(payment_proof_rejected_at) as oldest,
          (count(*) filter (where ${reviewHours}::int is not null
            and payment_proof_rejected_at <= ${now}::timestamptz - ${reviewHours ?? 0}::int * interval '1 hour'))::int as overdue
        from public.orders
        where status = 'awaiting payment' and payment_proof_rejections >= ${MANAGER_AFTER_REJECTIONS}::int and payment_proof_rejected_at is not null`;
      return row;
    },
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
    read: async (sql, now, history) => {
      // As the Tickets page: Unclaimed Open Tickets. The oldest waiting is the longest unanswered by Staff.
      const [row] = await sql<(Row & { overdue: number })[]>`
        select count(*)::int as count,
          (count(*) filter (where from_customer and overdue))::int as overdue,
          min(last_activity) filter (where from_customer) as oldest
        from (
          select coalesce(m.created_at, t.created_at) as last_activity,
            coalesce(m.sender, 'customer') = 'customer' as from_customer,
            coalesce(m.created_at, t.created_at) + ${firstReplyHoursSql(sql, history)} * interval '1 hour' < ${now} as overdue
          from public.tickets t
          left join lateral (
            select sender, created_at from public.ticket_messages
            where ticket_id = t.id and not internal order by created_at desc, id desc limit 1
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

/** Whether any Needs attention row is open to Staff holding these Modules. */
export function hasAttentionQueue(modules: readonly string[], manager = false): boolean {
  return queues.some(({ module, managerOnly }) => modules.includes(module) && (manager || !managerOnly));
}

async function one(rows: Promise<Row[]>): Promise<Row> {
  const [row] = await rows;

  return row;
}

export async function loadAttention(
  connect: () => postgres.Sql,
  { modules, now, targets, unconfirmedHours = DEFAULT_UNCONFIRMED_HOURS, reviewHours = DEFAULT_UNCONFIRMED_HOURS, manager = false }: {
    modules: readonly string[]; now: Date; targets?: TargetHistory | null;
    /** The Admin's target for a Manager payment review (null when switched off); 48 hours when not given. */
    reviewHours?: number | null;
    /** Managers also see the queues that need a Manager's decision. */
    manager?: boolean;
    /** The Admin's limit for an unconfirmed Order; null when the rule is switched off. */
    unconfirmedHours?: number | null;
  },
): Promise<Attention> {
  const held = queues.filter(({ module, managerOnly }) => modules.includes(module) && (manager || !managerOnly));

  const results = await Promise.all(held.map(async ({ key, read }) => {
    try {
      return [key, { ok: true, ...(await read(connect(), now, targets === undefined ? DEFAULT_HISTORY : requireTargets(targets), unconfirmedHours, reviewHours)) }] as const;
    } catch {
      return [key, { ok: false }] as const;
    }
  }));

  return Object.fromEntries(results) as Attention;
}

/** Overdue needs the Admin's first reply target; if it could not be read the queue says so rather than guess. */
function requireTargets(targets: TargetHistory | null): TargetHistory {
  if (!targets) throw new Error("Service levels are unavailable");

  return targets;
}
