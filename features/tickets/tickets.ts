import type postgres from "postgres";

export const TICKETS_PAGE_SIZE = 25;

/** A Ticket the Customer has gone this long without a Staff reply to is Overdue. */
export const OVERDUE_AFTER_HOURS = 24;

export type TicketTab = "open" | "waiting" | "resolved" | "completed" | "all" | "mine";

/** On hold joins this list when it ships (slice 2). */
export const TICKET_TABS: TicketTab[] = ["open", "waiting", "resolved", "completed", "all", "mine"];

export type TicketStatus = "open" | "resolved" | "completed";

export type TicketPriority = "low" | "normal" | "high" | "urgent";

export const TICKET_PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

/** The Claimed by filter value for Tickets nobody has claimed. */
export const UNCLAIMED = "unclaimed";

export interface TicketFilters {
  /** Ticket number (TKT-208 or 208), Customer name or email, or Linked order (#1042 or 1042). */
  q?: string;
  priority?: TicketPriority;
  category?: string;
  /** A Staff id, or UNCLAIMED. */
  claimedBy?: string;
  overdue?: boolean;
}

export interface TicketQuery extends TicketFilters {
  tab?: TicketTab;
  page?: number;
  pageSize?: number;
  /** Who is looking; the Mine tab lists their Claimed Tickets. */
  viewerId?: string;
  /** The moment Overdue is measured at; defaults to now. */
  now?: Date;
}

export interface TicketRow {
  /** The Ticket number is this id, written TKT-<id>. */
  id: number;
  subject: string;
  customerName: string;
  category: string;
  /** The Linked order; null shows as "None yet". */
  orderId: number | null;
  priority: TicketPriority;
  status: TicketStatus;
  /** Who Claimed it; null is Unclaimed. */
  claimedById: string | null;
  claimedByName: string | null;
  /** Open, and the last Message came from Staff. */
  waiting: boolean;
  overdue: boolean;
  lastActivity: Date;
}

export interface TicketList {
  rows: TicketRow[];
  /** Tickets per tab among those matching the search and filters. */
  counts: Record<TicketTab, number>;
  /** Open Tickets, and those that are Overdue, whatever the search and filters. */
  totalOpen: number;
  overdue: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type TicketListResult = { ok: true; list: TicketList } | { ok: false };

/** What a search term's number names: "TKT-208" a Ticket, "#1042" an Order, a bare number either. */
function searchNumber(term: string): { value: number; ticket: boolean; order: boolean } | null {
  const match = /^(tkt-?|#)?(\d{1,9})$/i.exec(term);
  if (!match) return null;

  const prefix = match[1]?.toLowerCase();

  return { value: Number(match[2]), ticket: prefix !== "#", order: !prefix?.startsWith("t") };
}

/**
 * The search condition over a Ticket `t` joined to its Customer `c`: the Ticket number, the Linked
 * order, or a part of the Customer's name or email. An empty search matches everything.
 */
export function ticketSearch(sql: postgres.Sql, raw: string | undefined) {
  const term = raw?.trim();
  if (!term) return sql`true`;

  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  const number = searchNumber(term);

  return sql`(
    c.full_name ilike ${pattern} or c.email ilike ${pattern}
    ${number?.ticket ? sql`or t.id = ${number.value}` : sql``}
    ${number?.order ? sql`or t.order_id = ${number.value}` : sql``}
  )`;
}

export interface TicketFilterOptions {
  categories: string[];
  claimers: { id: string; name: string }[];
}

/** What the Category and Claimed by filters offer: the Categories Tickets have, and everyone who has Claimed one. */
export async function listTicketFilterOptions(sql: postgres.Sql): Promise<TicketFilterOptions> {
  const categories = await sql<{ category: string }[]>`
    select distinct category from tickets order by category`;
  const claimers = await sql<{ id: string; name: string }[]>`
    select claimed_by_id as id, max(claimed_by_name) as name from tickets
    where claimed_by_id is not null
    group by claimed_by_id
    order by max(claimed_by_name)`;

  return { categories: categories.map((c) => c.category), claimers };
}

/**
 * The Tickets list: every Ticket, Claimed or not, with who Claimed it. "Waiting on customer" and
 * Overdue are derived from the last Message, never stored; a Ticket with no Messages counts from
 * when it was opened.
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

  const derived = (where: postgres.PendingQuery<postgres.Row[]>) => sql`
    with derived as (
      select
        t.id,
        t.subject,
        c.full_name as customer_name,
        t.category,
        t.order_id,
        t.priority,
        t.status,
        t.claimed_by_id,
        t.claimed_by_name,
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
      where ${where}
    )`;

  const claimedBy =
    query.claimedBy === undefined
      ? sql`true`
      : query.claimedBy === UNCLAIMED
        ? sql`t.claimed_by_id is null`
        : sql`t.claimed_by_id = ${query.claimedBy}`;

  const filtered = sql`${ticketSearch(sql, query.q)}
    and ${query.priority ? sql`t.priority = ${query.priority}` : sql`true`}
    and ${query.category ? sql`t.category = ${query.category}` : sql`true`}
    and ${claimedBy}`;

  const [counts] = await sql<Record<string, number>[]>`
    ${derived(filtered)}
    select
      count(*) filter (where status = 'open' and (not ${query.overdue ?? false} or overdue))::int as open,
      count(*) filter (where waiting and (not ${query.overdue ?? false} or overdue))::int as waiting,
      count(*) filter (where status = 'resolved' and not ${query.overdue ?? false})::int as resolved,
      count(*) filter (where status = 'completed' and not ${query.overdue ?? false})::int as completed,
      count(*) filter (where not ${query.overdue ?? false} or overdue)::int as all,
      count(*) filter (where claimed_by_id = ${query.viewerId ?? null}
        and (not ${query.overdue ?? false} or overdue))::int as mine
    from derived`;

  const [totals] = await sql<{ open: number; overdue: number }[]>`
    ${derived(sql`true`)}
    select
      count(*) filter (where status = 'open')::int as open,
      count(*) filter (where overdue)::int as overdue
    from derived`;

  const total = counts[tab];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);

  const tabFilter = {
    open: sql`status = 'open'`,
    waiting: sql`waiting`,
    resolved: sql`status = 'resolved'`,
    completed: sql`status = 'completed'`,
    all: sql`true`,
    mine: sql`claimed_by_id = ${query.viewerId ?? null}`,
  }[tab];

  const rows = await sql<Record<string, unknown>[]>`
    ${derived(filtered)}
    select * from derived
    where ${tabFilter} and (${query.overdue ? sql`overdue` : sql`true`})
    order by last_activity desc, id desc
    limit ${pageSize} offset ${(page - 1) * pageSize}`;

  return {
    rows: rows.map((r) => ({
      id: r.id as number,
      subject: r.subject as string,
      customerName: r.customer_name as string,
      category: r.category as string,
      orderId: (r.order_id as number | null) ?? null,
      priority: r.priority as TicketPriority,
      status: r.status as TicketStatus,
      claimedById: (r.claimed_by_id as string | null) ?? null,
      claimedByName: (r.claimed_by_name as string | null) ?? null,
      waiting: r.waiting as boolean,
      overdue: r.overdue as boolean,
      lastActivity: r.last_activity as Date,
    })),
    counts: {
      open: counts.open,
      waiting: counts.waiting,
      resolved: counts.resolved,
      completed: counts.completed,
      all: counts.all,
      mine: counts.mine,
    },
    totalOpen: totals.open,
    overdue: totals.overdue,
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
