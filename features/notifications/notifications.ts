import type postgres from "postgres";

export const DEFAULT_SCHEMA = "crms";

export interface NewCustomer {
  id: string;
  name: string;
}

export type NotificationKind = "new-customer" | "ticket-new" | "ticket-message" | "ticket-not-fixed" | "feedback-low";

export interface Notification {
  id: string;
  kind: NotificationKind;
  customerId: string;
  customerName: string;
  /** The Ticket a Ticket notification is about; null for a New Customer. */
  ticketId: number | null;
  /** The Order and star rating a Feedback notification is about; null for the other kinds. */
  orderId: number | null;
  rating: number | null;
  /** When CREOMS first saw the event, such as the person becoming a Customer. */
  createdAt: Date;
  read: boolean;
}

/**
 * Whose bell is being read. New Customer alerts go to Staff with the Customer Profiles Module.
 * Ticket alerts go to Staff with the Tickets Module (`ticketsStaffId` is their Portal id, null
 * without the Module): to everyone when addressed to no one, otherwise to the Claimer alone.
 * Feedback alerts go to Staff with the Feedback Module.
 */
export interface Viewer {
  customerProfiles: boolean;
  ticketsStaffId: string | null;
  feedback: boolean;
}

const NEW_CUSTOMER_VIEWER: Viewer = { customerProfiles: true, ticketsStaffId: null, feedback: false };

/** The rows of `crms.notifications` this viewer may see and mark read. */
function visibleTo(sql: postgres.Sql, viewer: Viewer) {
  return sql`(
    (kind = 'new-customer' and ${viewer.customerProfiles})
    or (kind = 'feedback-low' and ${viewer.feedback})
    or (kind not in ('new-customer', 'feedback-low') and ${viewer.ticketsStaffId !== null}
      and (recipient_id is null or recipient_id = ${viewer.ticketsStaffId}))
  )`;
}

export interface NotificationFeed {
  unread: number;
  notifications: Notification[];
}

export interface SyncResult {
  /** True on the very first run, which only marks existing Customers as seen. */
  baselined: boolean;
  created: number;
}

/** The schema name goes into SQL text, so it must be a plain identifier. */
export function schemaIdent(sql: postgres.Sql, schema: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Invalid schema name: ${schema}`);

  return sql(schema);
}

/**
 * Creates one notification for each Customer CREOMS has not seen before. Idempotent and safe to
 * run concurrently: runs serialise on an advisory lock, and the unique customer_id is the
 * backstop. The very first run marks everyone as seen without creating notifications.
 *
 * `customers` is every verified Customer, read from the storefront by the read-only role.
 */
export async function syncNewCustomers(
  writer: postgres.Sql,
  customers: NewCustomer[],
  schema: string = DEFAULT_SCHEMA,
): Promise<SyncResult> {
  const s = schemaIdent(writer, schema);
  const ids = customers.map((c) => c.id);

  return writer.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`${schema}.sync`}))`;

    const [state] = await tx`select 1 from ${s}.sync_state`;
    const baselined = state === undefined;

    const fresh = await tx<{ customer_id: string }[]>`
      insert into ${s}.seen_customers (customer_id)
      select * from unnest(${ids}::text[])
      on conflict do nothing
      returning customer_id`;

    if (baselined) {
      await tx`insert into ${s}.sync_state default values`;

      return { baselined: true, created: 0 };
    }

    if (fresh.length === 0) return { baselined: false, created: 0 };

    const nameById = new Map(customers.map((c) => [c.id, c.name]));
    const freshIds = fresh.map((f) => f.customer_id);
    const freshNames = freshIds.map((id) => nameById.get(id) ?? "");

    const created = await tx`
      insert into ${s}.notifications (customer_id, customer_name)
      select * from unnest(${freshIds}::text[], ${freshNames}::text[])
      on conflict (customer_id) where kind = 'new-customer' do nothing
      returning id`;

    return { baselined: false, created: created.length };
  });
}

/** Unread count and the most recent notifications the viewer may see, newest first. Read state is shared. */
export async function listNotifications(
  writer: postgres.Sql,
  schema: string = DEFAULT_SCHEMA,
  limit = 20,
  viewer: Viewer = NEW_CUSTOMER_VIEWER,
): Promise<NotificationFeed> {
  const s = schemaIdent(writer, schema);

  const [{ unread }] = await writer<{ unread: number }[]>`
    select count(*)::int as unread from ${s}.notifications
    where read_at is null and ${visibleTo(writer, viewer)}`;

  const rows = await writer<
    {
      id: string;
      kind: NotificationKind;
      customer_id: string;
      customer_name: string;
      ticket_id: number | null;
      order_id: number | null;
      rating: number | null;
      created_at: Date;
      read_at: Date | null;
    }[]
  >`
    select id::text, kind, customer_id, customer_name, ticket_id, order_id, rating, created_at, read_at
    from ${s}.notifications
    where ${visibleTo(writer, viewer)}
    order by created_at desc, id desc
    limit ${limit}`;

  return {
    unread,
    notifications: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      customerId: r.customer_id,
      customerName: r.customer_name,
      ticketId: r.ticket_id,
      orderId: r.order_id,
      rating: r.rating,
      createdAt: r.created_at,
      read: r.read_at !== null,
    })),
  };
}

export async function markRead(
  writer: postgres.Sql,
  id: string,
  schema: string = DEFAULT_SCHEMA,
  viewer: Viewer = NEW_CUSTOMER_VIEWER,
): Promise<void> {
  if (!/^\d+$/.test(id)) return;

  const s = schemaIdent(writer, schema);

  await writer`
    update ${s}.notifications set read_at = now()
    where id = ${id}::bigint and read_at is null and ${visibleTo(writer, viewer)}`;
}

/** Marks read only what the viewer can see, so one Module's Staff never clear another's alerts. */
export async function markAllRead(
  writer: postgres.Sql,
  schema: string = DEFAULT_SCHEMA,
  viewer: Viewer = NEW_CUSTOMER_VIEWER,
): Promise<void> {
  const s = schemaIdent(writer, schema);

  await writer`
    update ${s}.notifications set read_at = now()
    where read_at is null and ${visibleTo(writer, viewer)}`;
}

/** Every verified Customer in the storefront, via the read-only role. Leads are excluded. */
export async function readCustomers(reader: postgres.Sql): Promise<NewCustomer[]> {
  return reader<NewCustomer[]>`
    select c.id, c.full_name as name
    from public.customers c
    join neon_auth."user" u on u.id::text = c.id and u."emailVerified"`;
}
