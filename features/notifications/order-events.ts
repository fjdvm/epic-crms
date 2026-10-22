import type postgres from "postgres";

import { DEFAULT_SCHEMA, schemaIdent, type SyncResult } from "./notifications";

type OrderEventKind = "order-delivery-fee" | "order-payment-proof";

interface OrderEvent {
  key: string;
  kind: OrderEventKind;
  orderId: number;
  customerId: string;
  customerName: string;
}

/** Read only from the storefront: a Delivery Order needing a fee, or a submitted GCash proof.
 * Proofs remain events after the Order moves on, so a payment checked between polls is still seen.
 * A Customer submits proof once; each kind therefore has one stable key per Order.
 */
export async function readOrderEvents(reader: postgres.Sql): Promise<OrderEvent[]> {
  const rows = await reader<{
    key: string; kind: OrderEventKind; order_id: number; customer_id: string; customer_name: string;
  }[]>`
    select 'order-delivery-fee:' || o.id as key, 'order-delivery-fee' as kind,
      o.id as order_id, o.customer_id, c.full_name as customer_name
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where o.status = 'placed' and o.fulfillment_method = 'delivery' and o.delivery_fee_in_centavos is null

    union all

    select 'order-payment-proof:' || o.id, 'order-payment-proof', o.id, o.customer_id, c.full_name
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where o.payment_method = 'gcash' and o.payment_proof_submitted_at is not null`;

  return rows.map((r) => ({
    key: r.key, kind: r.kind, orderId: r.order_id, customerId: r.customer_id, customerName: r.customer_name,
  }));
}

/** One shared alert per event; Module visibility is enforced when Staff read or clear the feed.
 * The first run only records existing events. The lock and ledger make repeated and concurrent
 * runs idempotent. Only the writer's crms schema is changed.
 */
export async function syncOrderEvents(
  writer: postgres.Sql,
  reader: postgres.Sql,
  schema: string = DEFAULT_SCHEMA,
): Promise<SyncResult> {
  const s = schemaIdent(writer, schema);
  const events = await readOrderEvents(reader);

  return writer.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`${schema}.order-sync`}))`;
    const [state] = await tx`select 1 from ${s}.order_sync_state`;

    const fresh = await tx<{ event_key: string }[]>`
      insert into ${s}.seen_order_events (event_key)
      select * from unnest(${events.map((e) => e.key)}::text[])
      on conflict do nothing
      returning event_key`;

    if (state === undefined) {
      await tx`insert into ${s}.order_sync_state default values`;
      return { baselined: true, created: 0 };
    }

    if (fresh.length === 0) return { baselined: false, created: 0 };

    const freshKeys = new Set(fresh.map((f) => f.event_key));
    const arrived = events.filter((e) => freshKeys.has(e.key));
    const created = await tx`
      insert into ${s}.notifications (kind, customer_id, customer_name, order_id)
      select * from unnest(
        ${arrived.map((e) => e.kind)}::text[],
        ${arrived.map((e) => e.customerId)}::text[],
        ${arrived.map((e) => e.customerName)}::text[],
        ${arrived.map((e) => e.orderId)}::integer[]
      ) returning id`;

    return { baselined: false, created: created.length };
  });
}
