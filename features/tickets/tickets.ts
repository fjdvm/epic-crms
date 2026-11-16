import type postgres from "postgres";

import { DEFAULT_HISTORY, firstReplyHoursSql, type ServiceLevel } from "./service-level";
import { withServiceLevels, type ServiceLevels } from "./service-level-store";

export const TICKETS_PAGE_SIZE = 25;

export type TicketTab = "open" | "waiting" | "resolved";

export const TICKET_TABS: TicketTab[] = ["open", "waiting", "resolved"];

export type TicketStatus = "open" | "on_hold" | "resolved" | "completed";

export type HoldReason = "courier" | "kitchen_or_ims" | "supplier" | "manager_decision";

/** What the Claimer is waiting on, as the Put on hold dialog words it. */
export const HOLD_REASONS: { value: HoldReason; label: string; hint?: string }[] = [
  { value: "courier", label: "Courier (Lalamove or Grab)", hint: "Rider pickup, return trip" },
  { value: "kitchen_or_ims", label: "Kitchen or IMS", hint: "Fresh batch, stock count, QC check" },
  { value: "supplier", label: "Supplier", hint: "Packaging, ingredients" },
  { value: "manager_decision", label: "Manager decision" },
];

export const HOLD_NOTE_MAX = 500;
export const HOLD_MESSAGE_MAX = 500;

/** Why a Ticket is On hold and when it returns to Open. Staff only: the Customer is only ever told "We're on it". */
export interface TicketHold {
  reason: HoldReason;
  note: string | null;
  until: Date;
}

export type TicketPriority = "low" | "normal" | "high" | "urgent";

export const TICKET_PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

export interface TicketQuery {
  tab?: TicketTab;
  page?: number;
  pageSize?: number;
  /** The moment Overdue is measured at; defaults to now. */
  now?: Date;
  /** The saved Service levels; the defaults when not given. */
  levels?: ServiceLevels;
}

export interface TicketRow {
  /** The Ticket number is this id, written TKT-<id>. */
  id: number;
  subject: string;
  customerName: string;
  /** The Linked order; null shows as "None yet". */
  orderId: number | null;
  priority: TicketPriority;
  status: TicketStatus;
  /** Open, and the last Message came from Staff. */
  waiting: boolean;
  overdue: boolean;
  lastActivity: Date;
  /** The countdown to the first reply or resolve target. */
  serviceLevel: ServiceLevel;
}

export interface TicketList {
  rows: TicketRow[];
  counts: Record<TicketTab, number>;
  /** Open Tickets that are Overdue, across all tabs. */
  overdue: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type TicketListResult = { ok: true; list: TicketList } | { ok: false };

/**
 * The Tickets list: only Unclaimed Tickets, since a Claimed one is its Claimer's to work from the
 * Conversations inbox. "Waiting on customer" and Overdue are derived from the last Message, never
 * stored; a Ticket with no Messages counts from when it was opened.
 */
export async function listTickets(
  sql: postgres.Sql,
  query: TicketQuery = {},
): Promise<TicketList> {
  const tab = query.tab ?? "open";
  const pageSize = query.pageSize ?? TICKETS_PAGE_SIZE;
  const now = query.now ?? new Date();
  const levels = query.levels ?? { history: DEFAULT_HISTORY };

  const derived = sql`
    with derived as (
      select
        t.id,
        t.subject,
        c.full_name as customer_name,
        t.order_id,
        t.priority,
        t.status,
        t.created_at,
        t.resolved_at,
        t.held_seconds,
        t.hold_started_at,
        coalesce(m.created_at, t.created_at) as last_activity,
        t.status = 'open' and coalesce(m.sender, 'customer') = 'staff' as waiting,
        t.status = 'open' and coalesce(m.sender, 'customer') = 'customer'
          and coalesce(m.created_at, t.created_at) + ${firstReplyHoursSql(sql, levels.history)} * interval '1 hour' < ${now} as overdue
      from tickets t
      join customers c on c.id = t.customer_id
      left join lateral (
        select sender, created_at from ticket_messages
        where ticket_id = t.id
        order by created_at desc, id desc
        limit 1
      ) m on true
      where t.claimed_by_id is null
    )`;

  const [counts] = await sql<Record<string, number>[]>`
    ${derived}
    select
      count(*) filter (where status = 'open')::int as open,
      count(*) filter (where waiting)::int as waiting,
      count(*) filter (where status in ('resolved', 'completed'))::int as resolved,
      count(*) filter (where overdue)::int as overdue
    from derived`;

  const total = counts[tab];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);

  const tabFilter =
    tab === "open"
      ? sql`status = 'open'`
      : tab === "waiting"
        ? sql`waiting`
        : sql`status in ('resolved', 'completed')`;

  const rows = await sql<Record<string, unknown>[]>`
    ${derived}
    select * from derived
    where ${tabFilter}
    order by last_activity desc, id desc
    limit ${pageSize} offset ${(page - 1) * pageSize}`;

  const ids = rows.map((r) => r.id as number);
  const messageRows = ids.length
    ? await sql<{ ticket_id: number; sender: "customer" | "staff"; created_at: Date }[]>`
        select ticket_id, sender, created_at from ticket_messages
        where ticket_id = any(${ids}::int[]) order by ticket_id, created_at, id`
    : [];
  const levelsById = await withServiceLevels(
    levels,
    rows.map((r) => ({
      id: r.id as number,
      createdAt: r.created_at as Date,
      input: {
        status: r.status as TicketStatus,
        resolvedAt: (r.resolved_at as Date | null) ?? null,
        heldSeconds: r.held_seconds as number,
        holdStartedAt: (r.hold_started_at as Date | null) ?? null,
        messages: messageRows
          .filter((m) => m.ticket_id === r.id)
          .map((m) => ({ sender: m.sender, at: m.created_at })),
      },
    })),
    now,
  );

  return {
    rows: rows.map((r) => ({
      id: r.id as number,
      subject: r.subject as string,
      customerName: r.customer_name as string,
      orderId: (r.order_id as number | null) ?? null,
      priority: r.priority as TicketPriority,
      status: r.status as TicketStatus,
      waiting: r.waiting as boolean,
      overdue: r.overdue as boolean,
      lastActivity: r.last_activity as Date,
      serviceLevel: levelsById.get(r.id as number)!,
    })),
    counts: { open: counts.open, waiting: counts.waiting, resolved: counts.resolved },
    overdue: counts.overdue,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Like listTickets, but an unreachable database becomes `{ ok: false }` so the page can say so in
 * place instead of crashing into the framework's generic error page.
 */
export async function loadTickets(
  connect: () => postgres.Sql,
  query: TicketQuery,
): Promise<TicketListResult> {
  try {
    return { ok: true, list: await listTickets(connect(), query) };
  } catch (error) {
    console.error("Tickets could not read the ecommerce database", error);
    return { ok: false };
  }
}
