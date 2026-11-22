import type postgres from "postgres";

import { loadAutomaticChecks } from "@/features/settings/automatic-checks";
import { MANAGER_AFTER_REJECTIONS } from "@/features/orders/payment-methods";
import { DEFAULT_SCHEMA, schemaIdent, type SyncResult } from "./notifications";

type OrderEventKind = "order-delivery-fee" | "order-placed" | "order-free-delivery" | "order-payment-proof" | "order-overdue" | "payment-review" | "payment-review-overdue";

interface OrderEvent {
  key: string;
  kind: OrderEventKind;
  orderId: number;
  customerId: string;
  customerName: string;
}

/** Read placement of every Order and submitted proofs (GCash, Maya or bank transfer) from the storefront.
 * Proofs remain events after the Order moves on, so a payment checked between two syncs is still seen.
 * The first proof has one stable key per Order; each resubmission after a rejection has its own.
 */
export async function readOrderEvents(reader: postgres.Sql, overdueHours: number | null = null, reviewHours: number | null = null): Promise<OrderEvent[]> {
  const rows = await reader<{
    key: string; kind: OrderEventKind; order_id: number; customer_id: string; customer_name: string;
  }[]>`
    select 'order-placed:' || o.id as key,
      case when o.status = 'placed' and o.fulfillment_method = 'delivery' and o.delivery_fee_in_centavos is null
        then 'order-delivery-fee'
        when o.fulfillment_method = 'delivery' and o.subtotal_in_centavos > 250000 and o.delivery_fee_in_centavos = 0
        then 'order-free-delivery' else 'order-placed' end as kind,
      o.id as order_id, o.customer_id, c.full_name as customer_name
    from public.orders o
    join public.customers c on c.id = o.customer_id

    union all

    select 'order-payment-proof:' || o.id, 'order-payment-proof', o.id, o.customer_id, c.full_name
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where o.payment_method in ('gcash', 'maya', 'bank-transfer') and o.payment_proof_submitted_at is not null

    union all

    -- Every proof after the first is a new alert; the first keeps its original key so history is not re-announced.
    select 'order-payment-proof:' || o.id || ':' || p.id, 'order-payment-proof', o.id, o.customer_id, c.full_name
    from public.order_payment_proofs p
    join public.orders o on o.id = p.order_id
    join public.customers c on c.id = o.customer_id
    where p.id > (select min(first.id) from public.order_payment_proofs first where first.order_id = p.order_id)

    union all

    -- An Order of any kind still unconfirmed (status placed) past the Admin's limit: one alert per Order, ever.
    -- A null limit (the rule is switched off) reads nothing. Nothing is cancelled.
    select 'order-overdue:' || o.id, 'order-overdue', o.id, o.customer_id, c.full_name
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where ${overdueHours}::int is not null and o.status = 'placed'
      and o.created_at <= now() - ${overdueHours ?? 0}::int * interval '1 hour'

    union all

    -- The third rejected proof starts a Manager payment review: one alert per Order.
    select 'payment-review:' || o.id, 'payment-review', o.id, o.customer_id, c.full_name
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where o.status = 'awaiting payment' and o.payment_proof_rejections >= ${MANAGER_AFTER_REJECTIONS}::int
      and o.payment_proof_rejected_at is not null

    union all

    -- Past the Admin's target the review is Overdue. Each further whole target period is a new key, so the
    -- alert repeats until a Manager settles the Order. A null target (switched off) reads nothing. Nothing is cancelled.
    select 'payment-review-overdue:' || o.id || ':' || (floor(extract(epoch from now() - o.payment_proof_rejected_at) / 3600 / ${reviewHours ?? 1}::int)::int),
      'payment-review-overdue', o.id, o.customer_id, c.full_name
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where ${reviewHours}::int is not null and o.status = 'awaiting payment' and o.payment_proof_rejections >= ${MANAGER_AFTER_REJECTIONS}::int
      and o.payment_proof_rejected_at is not null
      and o.payment_proof_rejected_at <= now() - ${reviewHours ?? 0}::int * interval '1 hour'`;

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
  const checks = await loadAutomaticChecks(writer);
  const limit = checks.dashboard.unconfirmedOrders;
  const review = checks.dashboard.paymentReviews;
  const events = await readOrderEvents(reader, limit.enabled ? limit.hours : null, review.enabled ? review.hours : null);

  return writer.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`${schema}.order-sync`}))`;
    const [state] = await tx`select all_orders_baselined from ${s}.order_sync_state`;

    const fresh = await tx<{ event_key: string }[]>`
      insert into ${s}.seen_order_events (event_key)
      select * from unnest(${events.map((e) => e.key)}::text[])
      on conflict do nothing
      returning event_key`;

    if (state === undefined) {
      await tx`insert into ${s}.order_sync_state (all_orders_baselined) values (true)`;
      return { baselined: true, created: 0 };
    }

    if (!state.all_orders_baselined) await tx`update ${s}.order_sync_state set all_orders_baselined = true`;

    if (fresh.length === 0) return { baselined: false, created: 0 };

    const freshKeys = new Set(fresh.map((f) => f.event_key));
    const arrived = events.filter((e) => freshKeys.has(e.key) && (state.all_orders_baselined || !["order-placed", "order-free-delivery"].includes(e.kind)));
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
