import type postgres from "postgres";

export const TICKETS_PAGE_SIZE = 25;

/** A Ticket the Customer has gone this long without a Staff reply to is Overdue. */
const OVERDUE_AFTER_HOURS = 24;

export type TicketTab = "open" | "waiting" | "resolved";

export const TICKET_TABS: TicketTab[] = ["open", "waiting", "resolved"];

export type TicketStatus = "open" | "resolved" | "completed";

export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface TicketQuery {
  tab?: TicketTab;
  page?: number;
  pageSize?: number;
  /** The moment Overdue is measured at; defaults to now. */
  now?: Date;
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
 * The Tickets list. "Waiting on customer" and Overdue are derived from the last Message, never
 * stored; a Ticket with no Messages counts from when it was opened.
 */
export async function listTickets(
  sql: postgres.Sql,
  query: TicketQuery = {},
): Promise<TicketList> {
  const tab = query.tab ?? "open";
  const pageSize = query.pageSize ?? TICKETS_PAGE_SIZE;
  const overdueBefore = new Date(
    (query.now ?? new Date()).getTime() - OVERDUE_AFTER_HOURS * 60 * 60 * 1000,
  );

  const derived = sql`
    with derived as (
      select
        t.id,
        t.subject,
        c.full_name as customer_name,
        t.order_id,
        t.priority,
        t.status,
        coalesce(m.created_at, t.created_at) as last_activity,
        t.status = 'open' and coalesce(m.sender, 'customer') = 'staff' as waiting,
        t.status = 'open' and coalesce(m.sender, 'customer') = 'customer'
          and coalesce(m.created_at, t.created_at) < ${overdueBefore} as overdue
      from tickets t
      join customers c on c.id = t.customer_id
      left join lateral (
        select sender, created_at from ticket_messages
        where ticket_id = t.id
        order by created_at desc, id desc
        limit 1
      ) m on true
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
