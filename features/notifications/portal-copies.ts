import type postgres from "postgres";
import { describeNotification } from "./describe";
import { DEFAULT_SCHEMA, schemaIdent, visibleTo, type Notification, type Viewer } from "./notifications";

export interface PortalCopies {
  recipients(): Promise<{ id: string; modules: string[] }[]>;
  send(copy: { key: string; userId: string; text: string; link: string }): Promise<{ id: string; read: boolean }>;
  find(userId: string, key: string): Promise<{ id: string; read: boolean } | null>;
  status(userId: string, id: string): Promise<{ id: string; read: boolean }>;
  markRead(userId: string, id: string): Promise<void>;
}

/** Snapshot the audience once; recheck access before sending, and retain every delivered copy.
 * The remote idempotency key closes the gap between remote delivery and our local commit.
 */
export async function syncPortalCopies(writer: postgres.Sql, portal: PortalCopies, appUrl: string, schema = DEFAULT_SCHEMA): Promise<void> {
  const s = schemaIdent(writer, schema);
  const unresolved = await writer<{ id: string }[]>`
    select n.id::text from ${s}.notifications n where not exists (select 1 from ${s}.portal_copy_audiences a where a.notification_id = n.id)`;
  const [pending] = await writer<{ exists: boolean }[]>`select exists(select 1 from ${s}.portal_copies where remote_id is null) as exists`;
  let staff: Awaited<ReturnType<PortalCopies["recipients"]>> | null = null;
  try {
    if (unresolved.length || pending.exists) staff = await portal.recipients();
    if (unresolved.length && staff) {
      const audience = staff;
      await writer.begin(async tx => {
        for (const { id } of unresolved) {
          const claimed = await tx`insert into ${s}.portal_copy_audiences (notification_id) values (${id}::bigint)
            on conflict do nothing returning notification_id`;
          if (!claimed.length) continue;
          for (const person of audience) {
            const viewer = staffViewer(person);
            await tx`insert into ${s}.portal_copies (notification_id, user_id)
              select id, ${person.id} from ${s}.notifications where id = ${id}::bigint and ${visibleTo(tx, viewer)}
              on conflict do nothing`;
          }
        }
      });
    }
  } catch (error) { console.error("Portal audience could not be resolved", error); }

  const copies = await writer<(Notification & { userId: string; remoteId: string | null })[]>`
    select n.id::text, n.kind, n.customer_id as "customerId", n.customer_name as "customerName",
      n.ticket_id as "ticketId", n.order_id as "orderId", n.rating, n.return_id as "returnId",
      n.created_at as "createdAt", n.read_at is not null as read, c.user_id as "userId", c.remote_id as "remoteId"
    from ${s}.portal_copies c join ${s}.notifications n on n.id = c.notification_id
    where not c.read_synced order by c.last_attempt_at nulls first, n.id, c.user_id limit 100`;

  // Isolate each recipient's failure, including a response lost after the service stored the copy.
  await inBatches(copies, async copy => {
    try {
      await writer`update ${s}.portal_copies set last_attempt_at = now()
        where notification_id = ${copy.id}::bigint and user_id = ${copy.userId}`;
      if (copy.remoteId && copy.read) {
        await markCopyRead(copy.id, copy.userId, copy.remoteId);
        return;
      }
      let remote;
      if (copy.remoteId) remote = await portal.status(copy.userId, copy.remoteId);
      else {
        const key = `creoms.order.${copy.id}`;
        const person = staff?.find(person => person.id === copy.userId);
        const allowed = person ? await writer`select 1 from ${s}.notifications where id = ${copy.id}::bigint
          and ${visibleTo(writer, staffViewer(person))}` : [];
        if (allowed.length) {
          const description = describeNotification(copy);
          remote = await portal.send({ key, userId: copy.userId, text: description.text,
            link: new URL(description.href, appUrl).href });
        } else {
          // Recover an uncertain prior send without creating anything for revoked Staff.
          remote = await portal.find(copy.userId, key);
          if (!remote) return;
        }
      }
      await writer`update ${s}.portal_copies set remote_id = ${remote.id}
        where notification_id = ${copy.id}::bigint and user_id = ${copy.userId}`;
      if (remote.read) await writer`update ${s}.notifications set read_at = coalesce(read_at, now()) where id = ${copy.id}::bigint`;
    } catch (error) { console.error("Portal copy could not be synced", error); }
  });
  // Read state is shared in CREOMS: one read clears every existing Portal copy, including revoked Staff.
  const read = await writer<{ id: string; userId: string; remoteId: string }[]>`
    select n.id::text, c.user_id as "userId", c.remote_id as "remoteId"
    from ${s}.portal_copies c join ${s}.notifications n on n.id = c.notification_id
    where n.read_at is not null and c.remote_id is not null and not c.read_synced
    order by c.last_attempt_at nulls first, n.id limit 100`;
  await inBatches(read, async copy => {
    try {
      await markCopyRead(copy.id, copy.userId, copy.remoteId);
    } catch (error) { console.error("Portal copy read could not be synced", error); }
  });
  async function markCopyRead(id: string, userId: string, remoteId: string) {
    await portal.markRead(userId, remoteId);
    await writer`update ${s}.portal_copies set read_synced = true
      where notification_id = ${id}::bigint and user_id = ${userId}`;
  }
}

function staffViewer({ id, modules }: { id: string; modules: string[] }): Viewer {
  return { customerProfiles: modules.includes("Customer Profiles"),
    ticketsStaffId: modules.includes("Tickets") ? id : null,
    feedback: modules.includes("Feedback"), returns: modules.includes("Returns"),
    orders: modules.includes("Orders"), payments: modules.includes("Payments") };
}

/** Bound outage delays; unattempted work remains durable for the next poll or scheduler sync. */
async function inBatches<T>(rows: T[], run: (row: T) => Promise<void>): Promise<void> {
  const deadline = Date.now() + 4_000;
  for (let i = 0; i < rows.length && Date.now() < deadline; i += 10) {
    await Promise.all(rows.slice(i, i + 10).map(run));
  }
}
