import type postgres from "postgres";

import { DEFAULT_SCHEMA, schemaIdent, type NotificationKind, type SyncResult } from "./notifications";

/** Events older than this cannot newly appear, so reading stops here and the sync stays cheap. */
const WINDOW_DAYS = 14;

type TicketEventKind = Exclude<NotificationKind, "new-customer" | "feedback-low">;

export interface TicketEvent {
  /** Unique per event, so an alert appears once however many times or tabs sync. */
  key: string;
  kind: TicketEventKind;
  ticketId: number;
  customerId: string;
  customerName: string;
  /** The Claimer's Portal id; null alerts every Staff member with the Tickets Module. */
  recipientId: string | null;
}

/**
 * Ticket events the storefront caused, read from the shared database:
 * - a Ticket the Customer raised (not one Staff opened) alerts everyone;
 * - a Customer Message, other than the one that opened the Ticket, alerts the Claimer, or everyone
 *   while Unclaimed;
 * - an Open Ticket that was Resolved and has had no Customer Message since was sent back by "Not
 *   fixed", and alerts the same way. The storefront keeps `resolved_at` on reopening, so the pair
 *   is the one-per-resolution key.
 * A Customer completing a Ticket is not an event.
 */
export async function readTicketEvents(reader: postgres.Sql, now: Date = new Date()): Promise<TicketEvent[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await reader<
    { key: string; kind: TicketEventKind; ticket_id: number; customer_id: string; customer_name: string; recipient_id: string | null }[]
  >`
    with first_message as (
      select ticket_id, min(id) as id from ticket_messages group by ticket_id
    )
    select 'ticket-new:' || t.id as key, 'ticket-new' as kind, t.id as ticket_id,
      t.customer_id, c.full_name as customer_name, null::text as recipient_id
    from tickets t
    join customers c on c.id = t.customer_id
    left join ticket_messages opening on opening.id = (select id from first_message where ticket_id = t.id)
    where t.created_at >= ${since} and coalesce(opening.sender, 'customer') = 'customer'

    union all

    select 'ticket-message:' || m.id, 'ticket-message', t.id, t.customer_id, c.full_name, t.claimed_by_id
    from ticket_messages m
    join tickets t on t.id = m.ticket_id
    join customers c on c.id = t.customer_id
    where m.sender = 'customer' and m.created_at >= ${since}
      and m.id <> (select id from first_message where ticket_id = t.id)

    union all

    select 'ticket-not-fixed:' || t.id || ':' || (extract(epoch from t.resolved_at) * 1000000)::bigint,
      'ticket-not-fixed', t.id, t.customer_id, c.full_name, t.claimed_by_id
    from tickets t
    join customers c on c.id = t.customer_id
    where t.status = 'open' and t.resolved_at >= ${since}
      and not exists (
        select 1 from ticket_messages m
        where m.ticket_id = t.id and m.sender = 'customer' and m.created_at > t.resolved_at
      )`;

  return rows.map((r) => ({
    key: r.key,
    kind: r.kind,
    ticketId: r.ticket_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    recipientId: r.recipient_id,
  }));
}

/**
 * Creates one notification for each Ticket event CREOMS has not seen before. Idempotent and safe
 * to run concurrently: runs serialise on an advisory lock and the ledger's unique key is the
 * backstop. The very first run only marks the events already there as seen, so the bell starts
 * empty. `reader` reaches the storefront's tables; `writer` owns `crms`.
 */
export async function syncTicketEvents(
  writer: postgres.Sql,
  reader: postgres.Sql,
  schema: string = DEFAULT_SCHEMA,
  now: Date = new Date(),
): Promise<SyncResult> {
  const s = schemaIdent(writer, schema);
  const events = await readTicketEvents(reader, now);

  return writer.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`${schema}.ticket-sync`}))`;

    const [state] = await tx`select 1 from ${s}.ticket_sync_state`;
    const baselined = state === undefined;

    const fresh = await tx<{ event_key: string }[]>`
      insert into ${s}.seen_ticket_events (event_key)
      select * from unnest(${events.map((e) => e.key)}::text[])
      on conflict do nothing
      returning event_key`;

    if (baselined) {
      await tx`insert into ${s}.ticket_sync_state default values`;

      return { baselined: true, created: 0 };
    }

    if (fresh.length === 0) return { baselined: false, created: 0 };

    const freshKeys = new Set(fresh.map((f) => f.event_key));
    const arrived = events.filter((e) => freshKeys.has(e.key));

    const created = await tx`
      insert into ${s}.notifications (kind, customer_id, customer_name, ticket_id, recipient_id)
      select * from unnest(
        ${arrived.map((e) => e.kind)}::text[],
        ${arrived.map((e) => e.customerId)}::text[],
        ${arrived.map((e) => e.customerName)}::text[],
        ${arrived.map((e) => e.ticketId)}::integer[],
        ${arrived.map((e) => e.recipientId)}::text[]
      )
      returning id`;

    return { baselined: false, created: created.length };
  });
}
