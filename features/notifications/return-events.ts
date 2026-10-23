import type postgres from "postgres";

import { DEFAULT_SCHEMA, schemaIdent, type SyncResult } from "./notifications";

/**
 * One shared alert per Return request, visible only to Staff with the Returns Module.
 * Read requests in every status so progress between polls cannot hide the original request.
 * Later steps create no events. The first sync baselines existing Returns; the lock and
 * ledger make repeated and concurrent syncs idempotent. Only CREOMS tables are written.
 */
export async function syncReturnEvents(
  writer: postgres.Sql,
  reader: postgres.Sql,
  schema: string = DEFAULT_SCHEMA,
): Promise<SyncResult> {
  const s = schemaIdent(writer, schema);
  const events = await reader<{
    return_id: number; order_id: number; customer_id: string; customer_name: string;
  }[]>`
    select r.id as return_id, r.order_id, o.customer_id, c.full_name as customer_name
    from public.order_returns r
    join public.orders o on o.id = r.order_id
    join public.customers c on c.id = o.customer_id`;

  return writer.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`${schema}.return-sync`}))`;
    const [state] = await tx`select 1 from ${s}.return_sync_state`;
    const fresh = await tx<{ return_id: number }[]>`
      insert into ${s}.seen_returns (return_id)
      select * from unnest(${events.map(e => e.return_id)}::integer[])
      on conflict do nothing
      returning return_id`;

    if (state === undefined) {
      await tx`insert into ${s}.return_sync_state default values`;
      return { baselined: true, created: 0 };
    }
    if (fresh.length === 0) return { baselined: false, created: 0 };

    const freshIds = new Set(fresh.map(row => row.return_id));
    const arrived = events.filter(event => freshIds.has(event.return_id));
    const created = await tx`
      insert into ${s}.notifications (kind, customer_id, customer_name, order_id, return_id)
      select 'return-requested', * from unnest(
        ${arrived.map(e => e.customer_id)}::text[],
        ${arrived.map(e => e.customer_name)}::text[],
        ${arrived.map(e => e.order_id)}::integer[],
        ${arrived.map(e => e.return_id)}::integer[]
      ) returning id`;

    return { baselined: false, created: created.length };
  });
}
