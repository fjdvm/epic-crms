import type postgres from "postgres";

import { PAID_OR_FULFILLED } from "./rules";

export const PAGE_SIZE = 20;

/** Sortable columns, mapped to SQL over the `agg` CTE. Never built from user input. */
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

export interface CustomerListQuery {
  search?: string;
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
  lastOrder: Date | null;
  cartHasItems: boolean;
  customerSince: Date;
}

export interface CustomerList {
  rows: CustomerRow[];
  /** Customers matching the search. */
  matching: number;
  /** All Customers, ignoring the search: the count shown under the page title. */
  profileCount: number;
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
        exists (select 1 from public.cart_lines cl where cl.customer_id = c.id) as cart_has_items
      from public.customers c
      join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
      left join lateral (
        select
          count(*) as orders,
          sum(case when status = any(${PAID_OR_FULFILLED})
                   then subtotal_in_centavos + coalesce(delivery_fee_in_centavos, 0) else 0 end) as total_spent,
          max(created_at) as last_order
        from public.orders where customer_id = c.id
      ) o on true
    )`;

  const [counts] = await sql<{ matching: number; profile_count: number }[]>`
    ${withCustomers}
    select
      count(*) filter (where ${search === "" ? sql`true` : sql`
        name ilike ${pattern} or email ilike ${pattern} or contact_number ilike ${pattern}`})::int as matching,
      count(*)::int as profile_count
    from agg`;

  const totalPages = Math.max(1, Math.ceil(counts.matching / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), totalPages);

  const rows = await sql<Record<string, unknown>[]>`
    ${withCustomers}
    select * from agg
    where ${search === "" ? sql`true` : sql`
      name ilike ${pattern} or email ilike ${pattern} or contact_number ilike ${pattern}`}
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
      cartHasItems: r.cart_has_items as boolean,
      customerSince: r.customer_since as Date,
    })),
    matching: counts.matching,
    profileCount: counts.profile_count,
    page,
    pageSize,
    totalPages,
  };
}
