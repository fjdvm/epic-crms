import type postgres from "postgres";

import { PAID_OR_FULFILLED, stageCutoffs, type Stage } from "./rules";

export const PAGE_SIZE = 20;

/** Sortable columns, mapped to SQL over the `staged` CTE. Never built from user input. */
const SORT_COLUMNS = {
  name: "lower(name)",
  email: "lower(email)",
  contactNumber: "contact_number",
  orders: "orders",
  totalSpent: "total_spent",
  lastOrder: "last_order",
  customerSince: "customer_since",
} as const;

export type SortKey = keyof typeof SORT_COLUMNS;

export const SORT_KEYS = Object.keys(SORT_COLUMNS) as SortKey[];

export const STAGES: Stage[] = ["new", "first-order", "repeat", "at-risk", "lost"];

export interface CustomerListQuery {
  search?: string;
  /** Only Customers in this Stage. */
  stage?: Stage;
  /** The moment Stage is measured at; defaults to now. */
  now?: Date;
  /** Defaults to customerSince, descending: newest Customer first. */
  sort?: SortKey;
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface CustomerRow {
  id: string;
  name: string;
  email: string;
  contactNumber: string;
  orders: number;
  /** Centavos. */
  totalSpent: number;
  /** Latest non-cancelled Order. */
  lastOrder: Date | null;
  stage: Stage;
  cartHasItems: boolean;
  customerSince: Date;
}

export interface CustomerList {
  rows: CustomerRow[];
  /** Customers matching the search. */
  matching: number;
  /** All Customers, ignoring the search: the count shown under the page title. */
  profileCount: number;
  /** Customers per Stage among those matching the search, ignoring the Stage filter. */
  stageCounts: Record<Stage, number>;
  page: number;
  pageSize: number;
  totalPages: number;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Verified Customers from the shared ecommerce database; Leads never appear. */
export async function listCustomers(
  sql: postgres.Sql,
  query: CustomerListQuery = {},
): Promise<CustomerList> {
  const sortKey = query.sort && query.sort in SORT_COLUMNS ? query.sort : "customerSince";
  const direction = query.direction === "asc" ? "asc" : "desc";
  const pageSize = query.pageSize ?? PAGE_SIZE;
  const search = query.search?.trim() ?? "";
  const pattern = `%${escapeLike(search)}%`;

  const orderBy = sql.unsafe(
    `${SORT_COLUMNS[sortKey]} ${direction} nulls last, customer_since desc, id`,
  );

  const searchFilter =
    search === ""
      ? sql`true`
      : sql`name ilike ${pattern} or email ilike ${pattern} or contact_number ilike ${pattern}`;

  const { atRiskBefore, lostBefore } = stageCutoffs(query.now ?? new Date());
  const stageFilter = query.stage ? sql`stage = ${query.stage}` : sql`true`;

  const withCustomers = sql`
    with agg as (
      select
        c.id,
        c.full_name as name,
        c.email,
        c.contact_number,
        u."createdAt" as customer_since,
        coalesce(o.orders, 0)::int as orders,
        coalesce(o.total_spent, 0)::bigint as total_spent,
        o.last_order,
        coalesce(o.stage_orders, 0) as stage_orders,
        exists (select 1 from public.cart_lines cl where cl.customer_id = c.id) as cart_has_items
      from public.customers c
      join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
      left join lateral (
        select
          count(*) as orders,
          sum(case when status = any(${PAID_OR_FULFILLED})
                   then subtotal_in_centavos + coalesce(delivery_fee_in_centavos, 0) else 0 end) as total_spent,
          max(created_at) filter (where status <> 'cancelled') as last_order,
          count(*) filter (where status <> 'cancelled') as stage_orders
        from public.orders where customer_id = c.id
      ) o on true
    ),
    staged as (
      select agg.*,
        case
          when stage_orders = 0 then 'new'
          when last_order <= ${lostBefore} then 'lost'
          when last_order <= ${atRiskBefore} then 'at-risk'
          when stage_orders = 1 then 'first-order'
          else 'repeat'
        end as stage
      from agg
    )`;

  const [counts] = await sql<Record<string, number>[]>`
    ${withCustomers}
    select
      count(*) filter (where ${searchFilter} and ${stageFilter})::int as matching,
      count(*)::int as profile_count,
      count(*) filter (where ${searchFilter} and stage = 'new')::int as new,
      count(*) filter (where ${searchFilter} and stage = 'first-order')::int as first_order,
      count(*) filter (where ${searchFilter} and stage = 'repeat')::int as repeat,
      count(*) filter (where ${searchFilter} and stage = 'at-risk')::int as at_risk,
      count(*) filter (where ${searchFilter} and stage = 'lost')::int as lost
    from staged`;

  const totalPages = Math.max(1, Math.ceil(counts.matching / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);

  const rows = await sql<Record<string, unknown>[]>`
    ${withCustomers}
    select * from staged
    where ${searchFilter} and ${stageFilter}
    order by ${orderBy}
    limit ${pageSize} offset ${(page - 1) * pageSize}`;

  return {
    rows: rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      email: r.email as string,
      contactNumber: r.contact_number as string,
      orders: r.orders as number,
      totalSpent: Number(r.total_spent),
      lastOrder: (r.last_order as Date | null) ?? null,
      stage: r.stage as Stage,
      cartHasItems: r.cart_has_items as boolean,
      customerSince: r.customer_since as Date,
    })),
    matching: counts.matching,
    profileCount: counts.profile_count,
    stageCounts: {
      new: counts.new,
      "first-order": counts.first_order,
      repeat: counts.repeat,
      "at-risk": counts.at_risk,
      lost: counts.lost,
    },
    page,
    pageSize,
    totalPages,
  };
}

export type CustomerListResult =
  { ok: true; list: CustomerList } | { ok: false };

/**
 * Like listCustomers, but a missing or unreachable database becomes `{ ok: false }` so the page
 * can say so in place instead of crashing into the framework's generic error page.
 */
export async function loadCustomers(
  connect: () => postgres.Sql,
  query: CustomerListQuery,
): Promise<CustomerListResult> {
  try {
    return { ok: true, list: await listCustomers(connect(), query) };
  } catch (error) {
    console.error("Customer Profiles could not read the ecommerce database", error);
    return { ok: false };
  }
}
