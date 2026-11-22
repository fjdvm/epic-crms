import type postgres from "postgres";
import { customerNameSql } from "@/lib/deleted-customer";

import { DEFAULT_HISTORY, firstReplyHoursSql, type ServiceLevel } from "./service-level";
import { withServiceLevels, type ServiceLevels } from "./service-level-store";

export const TICKETS_PAGE_SIZE = 25;

export type TicketTab = "open" | "waiting" | "on_hold" | "resolved" | "completed" | "all" | "mine" | "staffs";

export const TICKET_TABS: TicketTab[] = ["open", "waiting", "on_hold", "resolved", "completed", "all", "mine", "staffs"];

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
/** The longest Internal note, in characters. */
export const NOTE_MAX = 2000;

/** Why a Ticket is On hold and when it returns to Open. Staff only: the Customer is only ever told "We're on it". */
export interface TicketHold {
  reason: HoldReason;
  note: string | null;
  until: Date;
}


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
  /** Only Tickets a Manager has been asked about. */
  escalated?: boolean;
}

export interface TicketQuery extends TicketFilters {
  tab?: TicketTab;
  page?: number;
  pageSize?: number;
  /** Who is looking; the Mine tab lists their Claimed Tickets. */
  viewerId?: string;
  /** The moment Overdue is measured at; defaults to now. */
  now?: Date;
  /** The Tickets with an open escalation, read from CREOMS's own schema; none when not given. */
  escalatedIds?: number[];
  /** The saved Service levels; the defaults when not given. */
  levels?: ServiceLevels;
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
  /** A Manager has been asked and has not acted. */
  escalated: boolean;
  /** When the Ticket was opened. */
  createdAt: Date;
  lastActivity: Date;
  /** The countdown to the first reply or resolve target. */
  serviceLevel: ServiceLevel;
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
  const now = query.now ?? new Date();
  const levels = query.levels ?? { history: DEFAULT_HISTORY };
  const escalatedIds = new Set(query.escalatedIds ?? []);

  const derived = (where: postgres.PendingQuery<postgres.Row[]>) => sql`
    with derived as (
      select
        t.id,
        t.subject,
        ${sql.unsafe(customerNameSql('c'))} as customer_name,
        t.category,
        t.order_id,
        t.priority,
        t.status,
        t.created_at,
        t.resolved_at,
        t.held_seconds,
        t.hold_started_at,
        t.claimed_by_id,
        t.claimed_by_name,
        coalesce(m.created_at, t.created_at) as last_activity,
        t.status = 'open' and coalesce(m.sender, 'customer') = 'staff' as waiting,
        t.status = 'open' and coalesce(m.sender, 'customer') = 'customer'
          and coalesce(m.created_at, t.created_at) + ${firstReplyHoursSql(sql, levels.history)} * interval '1 hour' < ${now} as overdue
      from tickets t
      join customers c on c.id = t.customer_id
      left join lateral (
        select sender, created_at from ticket_messages
        where ticket_id = t.id and not internal
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
    and ${claimedBy}
    and ${query.escalated ? sql`t.id = any(${query.escalatedIds ?? []}::int[])` : sql`true`}`;

  const [counts] = await sql<Record<string, number>[]>`
    ${derived(filtered)}
    select
      count(*) filter (where status = 'open' and claimed_by_id is null and (not ${query.overdue ?? false} or overdue))::int as open,
      count(*) filter (where waiting and (not ${query.overdue ?? false} or overdue))::int as waiting,
      count(*) filter (where status = 'on_hold' and not ${query.overdue ?? false})::int as on_hold,
      count(*) filter (where status = 'resolved' and not ${query.overdue ?? false})::int as resolved,
      count(*) filter (where status = 'completed' and not ${query.overdue ?? false})::int as completed,
      count(*) filter (where (claimed_by_id is null or claimed_by_id = ${query.viewerId ?? null})
        and (not ${query.overdue ?? false} or overdue))::int as all,
      count(*) filter (where claimed_by_id = ${query.viewerId ?? null}
        and (not ${query.overdue ?? false} or overdue))::int as mine,
      count(*) filter (where claimed_by_id is not null and status <> 'completed'
        and (not ${query.overdue ?? false} or overdue))::int as staffs
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
    // Open is the queue nobody has taken yet: a Claimed Ticket leaves it and shows under Mine for its Claimer.
    open: sql`status = 'open' and claimed_by_id is null`,
    waiting: sql`waiting`,
    on_hold: sql`status = 'on_hold'`,
    resolved: sql`status = 'resolved'`,
    completed: sql`status = 'completed'`,
    // Another person's claimed Ticket is theirs to work; it is not listed under All.
    all: sql`(claimed_by_id is null or claimed_by_id = ${query.viewerId ?? null})`,
    mine: sql`claimed_by_id = ${query.viewerId ?? null}`,
    // Held by a teammate; the Staffs tab narrows this to one person with the Claimed by filter.
    staffs: sql`claimed_by_id is not null and status <> 'completed'`,
  }[tab];

  const rows = await sql<Record<string, unknown>[]>`
    ${derived(filtered)}
    select * from derived
    where ${tabFilter} and (${query.overdue ? sql`overdue` : sql`true`})
    order by last_activity desc, id desc
    limit ${pageSize} offset ${(page - 1) * pageSize}`;

  const ids = rows.map((r) => r.id as number);
  const messageRows = ids.length
    ? await sql<{ ticket_id: number; sender: "customer" | "staff"; created_at: Date }[]>`
        select ticket_id, sender, created_at from ticket_messages
        where ticket_id = any(${ids}::int[]) and not internal order by ticket_id, created_at, id`
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
      category: r.category as string,
      orderId: (r.order_id as number | null) ?? null,
      priority: r.priority as TicketPriority,
      status: r.status as TicketStatus,
      claimedById: (r.claimed_by_id as string | null) ?? null,
      claimedByName: (r.claimed_by_name as string | null) ?? null,
      waiting: r.waiting as boolean,
      overdue: r.overdue as boolean,
      escalated: escalatedIds.has(r.id as number),
      createdAt: r.created_at as Date,
      lastActivity: r.last_activity as Date,
      serviceLevel: levelsById.get(r.id as number)!,
    })),
    counts: {
      open: counts.open,
      waiting: counts.waiting,
      on_hold: counts.on_hold,
      resolved: counts.resolved,
      completed: counts.completed,
      all: counts.all,
      mine: counts.mine,
      staffs: counts.staffs,
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
