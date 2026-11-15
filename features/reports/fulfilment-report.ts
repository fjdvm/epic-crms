import type postgres from "postgres";

import type { Period } from "@/features/dashboard/period";
import { shopRole } from "@/lib/portal/roles";
import { notReplacement } from "@/lib/replacement-order";

export interface FulfilmentFigures {
  /** Mean seconds from an Order being placed to being dispatched, for Orders dispatched in the period; none if there were none. */
  placedToDispatched: number | null;
  /** Mean seconds from dispatched to delivered, for Orders delivered in the period; none if there were none. */
  dispatchedToDelivered: number | null;
  /** Cancelled share of Orders placed in the period, 0 to 1; none if no Order was placed. */
  cancellationRate: number | null;
  /** Share of Orders delivered in the period that have a Return (not one the Customer cancelled), 0 to 1; none if none were delivered. */
  returnRate: number | null;
  placed: number;
  delivered: number;
}

export type FulfilmentReport = { ok: true; figures: FulfilmentFigures } | { ok: false; reason: "forbidden" | "unavailable" };

/** Managers, Admins and the CEO read it; Admin and CEO only read. Staff and unknown Roles never do. */
export function mayReadFulfilmentReport(role: string): boolean {
  const shop = shopRole(role);
  return shop === "manager" || shop === "admin" || shop === "ceo";
}

/**
 * Figures for a Philippine-Time period. Replacement Orders are excluded everywhere. The storefront records
 * `dispatched_at`; it is read through to_jsonb so CREOMS keeps working before the column exists.
 */
export async function loadFulfilmentReport(
  connect: () => postgres.Sql,
  { role, period }: { role: string; period: Pick<Period, "start" | "end"> },
): Promise<FulfilmentReport> {
  if (!mayReadFulfilmentReport(role)) return { ok: false, reason: "forbidden" };

  try {
    const sql = connect();
    const { start, end } = period;
    const dispatchedAt = sql`(to_jsonb(o)->>'dispatched_at')::timestamptz`;
    const [row] = await sql<{
      placed_to_dispatched: number | null; dispatched_to_delivered: number | null;
      placed: number; cancelled: number; delivered: number; returned: number;
    }[]>`
      select
        (select avg(extract(epoch from ${dispatchedAt} - o.created_at))::float8 from public.orders o
          where ${notReplacement(sql, "o")} and ${dispatchedAt} >= ${start} and ${dispatchedAt} < ${end}) as placed_to_dispatched,
        (select avg(extract(epoch from o.delivered_at - ${dispatchedAt}))::float8 from public.orders o
          where ${notReplacement(sql, "o")} and ${dispatchedAt} is not null and o.delivered_at >= ${start} and o.delivered_at < ${end}) as dispatched_to_delivered,
        (select count(*)::int from public.orders o
          where ${notReplacement(sql, "o")} and o.created_at >= ${start} and o.created_at < ${end}) as placed,
        (select count(*)::int from public.orders o
          where ${notReplacement(sql, "o")} and o.status = 'cancelled' and o.created_at >= ${start} and o.created_at < ${end}) as cancelled,
        (select count(*)::int from public.orders o
          where ${notReplacement(sql, "o")} and o.delivered_at >= ${start} and o.delivered_at < ${end}) as delivered,
        (select count(*)::int from public.orders o
          where ${notReplacement(sql, "o")} and o.delivered_at >= ${start} and o.delivered_at < ${end}
            and exists (select 1 from public.order_returns r where r.order_id = o.id and r.status <> 'cancelled')) as returned`;

    return { ok: true, figures: {
      placedToDispatched: row.placed_to_dispatched,
      dispatchedToDelivered: row.dispatched_to_delivered,
      cancellationRate: row.placed === 0 ? null : row.cancelled / row.placed,
      returnRate: row.delivered === 0 ? null : row.returned / row.delivered,
      placed: row.placed,
      delivered: row.delivered,
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
