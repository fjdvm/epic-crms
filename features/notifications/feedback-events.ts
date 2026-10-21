import type postgres from "postgres";

import { DEFAULT_SCHEMA, schemaIdent, type SyncResult } from "./notifications";

/** Feedback older than this cannot newly appear, so reading stops here and the sync stays cheap. */
const WINDOW_DAYS = 14;

/** Feedback of this many stars or fewer raises a Feedback notification. */
const LOW_RATING = 3;

export interface FeedbackEvent {
  orderId: number;
  rating: number;
  customerId: string;
  customerName: string;
}

/** Low-rating Feedback the storefront recorded in the window, read from the shared database. */
export async function readLowFeedback(reader: postgres.Sql, now: Date = new Date()): Promise<FeedbackEvent[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await reader<{ order_id: number; rating: number; customer_id: string; customer_name: string }[]>`
    select f.order_id, f.rating, c.id as customer_id, c.full_name as customer_name
    from order_feedback f
    join orders o on o.id = f.order_id
    join customers c on c.id = o.customer_id
    where f.rating <= ${LOW_RATING} and f.created_at >= ${since}`;

  return rows.map((r) => ({
    orderId: r.order_id,
    rating: r.rating,
    customerId: r.customer_id,
    customerName: r.customer_name,
  }));
}

/**
 * Creates one notification, for every Staff member with the Feedback Module, for each low-rating
 * Feedback CREOMS has not seen before. Idempotent and safe to run concurrently: runs serialise on
 * an advisory lock and the ledger's unique order is the backstop. The very first run only marks
 * the Feedback already there as seen, so the bell starts empty. `reader` reaches the storefront's
 * tables; `writer` owns `crms`.
 */
export async function syncFeedbackEvents(
  writer: postgres.Sql,
  reader: postgres.Sql,
  schema: string = DEFAULT_SCHEMA,
  now: Date = new Date(),
): Promise<SyncResult> {
  const s = schemaIdent(writer, schema);
  const events = await readLowFeedback(reader, now);

  return writer.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`${schema}.feedback-sync`}))`;

    const [state] = await tx`select 1 from ${s}.feedback_sync_state`;
    const baselined = state === undefined;

    const fresh = await tx<{ order_id: number }[]>`
      insert into ${s}.seen_feedback (order_id)
      select * from unnest(${events.map((e) => e.orderId)}::integer[])
      on conflict do nothing
      returning order_id`;

    if (baselined) {
      await tx`insert into ${s}.feedback_sync_state default values`;

      return { baselined: true, created: 0 };
    }

    if (fresh.length === 0) return { baselined: false, created: 0 };

    const freshOrders = new Set(fresh.map((f) => f.order_id));
    const arrived = events.filter((e) => freshOrders.has(e.orderId));

    const created = await tx`
      insert into ${s}.notifications (kind, customer_id, customer_name, order_id, rating)
      select 'feedback-low', * from unnest(
        ${arrived.map((e) => e.customerId)}::text[],
        ${arrived.map((e) => e.customerName)}::text[],
        ${arrived.map((e) => e.orderId)}::integer[],
        ${arrived.map((e) => e.rating)}::smallint[]
      )
      returning id`;

    return { baselined: false, created: created.length };
  });
}
