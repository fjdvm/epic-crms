import type postgres from "postgres";

import { stageOf, type Stage } from "@/features/customer-profiles/rules";

import type { Span } from "./period";
import { notReplacement } from "@/lib/replacement-order";

export interface CustomersByStage {
  counts: Record<Stage, number>;
}

/** Verified storefront Customers only. */
export async function customersByStageAt(sql: postgres.Sql, now: Date): Promise<CustomersByStage> {
  const rows = await sql<{ orders: number; last_order: Date | null }[]>`
    select count(o.id)::int as orders, max(o.created_at) as last_order
    from public.customers c
    join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
    left join public.orders o on o.customer_id = c.id and o.status <> 'cancelled' and ${notReplacement(sql, "o")}
    where to_jsonb(c)->>'deleted_at' is null
    group by c.id`;
  const counts: Record<Stage, number> = { new: 0, "first-order": 0, repeat: 0, "at-risk": 0, lost: 0 };
  for (const row of rows) counts[stageOf({ orders: row.orders, lastOrder: row.last_order }, now)]++;
  return { counts };
}

/** Customer since is the auth sign-up date, irrespective of when verification happened. */
export async function newCustomersIn(sql: postgres.Sql, span: Span): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from public.customers c
    join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
    where to_jsonb(c)->>'deleted_at' is null and u."createdAt" >= ${span.start} and u."createdAt" < ${span.end}`;
  return row.count;
}

/** Leads remain separate from verified Customers, regardless of the chosen period. */
export async function unverifiedLeads(sql: postgres.Sql): Promise<{ count: number }> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from public.customers c
    join neon_auth."user" u on u.id::text = c.id
    where not u."emailVerified" and to_jsonb(c)->>'deleted_at' is null`;
  return { count: row.count };
}
