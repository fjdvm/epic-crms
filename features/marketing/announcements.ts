import type postgres from "postgres";

import type { ImageStore } from "./image-limits";

/** An email's subject is cut off in inboxes past about this many characters. */
export const TITLE_LIMIT = 60;

export type AnnouncementState = "draft" | "scheduled" | "sent" | "failed";

/** The Staff member acting; their Portal username and display name. */
export interface Actor {
  id: string;
  name: string;
}

export interface AnnouncementInput {
  title: string;
  description: string;
  /** Public HTTPS addresses from addImage, in order. Omitted for a text-only Announcement. */
  images?: string[];
}

export interface AnnouncementRow {
  id: string;
  title: string;
  description: string;
  /** Public HTTPS addresses, in order. Empty for a text-only Announcement. */
  images: string[];
  state: AnnouncementState;
  scheduledFor: Date | null;
  sentAt: Date | null;
  /** Customers it was handed to; null until something has been handed over. */
  sentTo: number | null;
  createdByName: string;
  updatedByName: string;
  updatedAt: Date;
}

/** What the audit-logs service is told about a Staff action; the gateway adapter fills in the rest. */
export interface AuditEvent {
  action: "record.created" | "record.updated" | "record.deleted";
  actor: Actor;
  announcement: { id: string; title: string };
  description: string;
  /** How many Subscribers a send was for. Set only on sends. */
  subscribers?: number;
  occurredAt: Date;
}

/** The audit-logs boundary, reached through the api-gateway (see lib/gateway.ts). Tests replace it with a fake. */
export interface AuditLog {
  record(event: AuditEvent): Promise<void>;
}

/** A Customer who is a Subscriber: verified, with Marketing opt-in yes. */
export interface Subscriber {
  customerId: string;
  email: string;
}

/** Who the Subscribers are at this moment, read from the storefront's data. Tests replace it with a fake. */
export interface SubscriberSource {
  list(): Promise<Subscriber[]>;
}

/** What every Subscriber receives. */
export interface MarketingMail {
  title: string;
  description: string;
  images: string[];
}

/**
 * Hands one batch (at most SEND_BATCH_SIZE) to the notifications service, through the api-gateway, with each
 * Subscriber's own Unsubscribe link. Resolves with the Subscribers it was handed over to; throws if none were.
 */
export interface MarketingMailer {
  sendBatch(mail: MarketingMail, to: Subscriber[]): Promise<Subscriber[]>;
}

export interface Ports {
  audit: AuditLog;
  images: ImageStore;
  subscribers: SubscriberSource;
  mailer: MarketingMailer;
  now: () => Date;
}

/** The most recipients the notifications service accepts in one batch. */
export const SEND_BATCH_SIZE = 100;

/** A send that has not finished after this long is taken to have died, and may be started again. */
const STALE_SEND_MS = 10 * 60 * 1000;

export type InputRefusal = "empty-title" | "title-too-long" | "empty-description" | "invalid-image";

export type SaveResult = { ok: true; announcement: { id: string } } | { ok: false; reason: InputRefusal };
export type EditResult = { ok: true } | { ok: false; reason: InputRefusal | "not-found" | "not-a-draft" };
export type DeleteResult = { ok: true } | { ok: false; reason: "not-found" | "not-a-draft" };

export type SendResult =
  | { ok: true; state: "sent" | "failed"; subscribers: number }
  | { ok: false; reason: "not-found" | "not-sendable" | "no-subscribers" | "in-progress" };

export const SEND_REFUSALS: Record<Exclude<SendResult, { ok: true }>["reason"], string> = {
  "not-found": "That Announcement no longer exists.",
  "not-sendable": "That Announcement has already been sent, or cannot be sent from where it is.",
  "no-subscribers": "There are no Subscribers, so there is nobody to send it to.",
  "in-progress": "That Announcement is being sent right now. Check the list in a moment.",
};

export const INPUT_REFUSALS: Record<InputRefusal, string> = {
  "empty-title": "Give the Announcement a title.",
  "title-too-long": `Keep the title to ${TITLE_LIMIT} characters or fewer, so the subject is not cut off.`,
  "empty-description": "Write a description.",
  "invalid-image": "One of the images is not a valid image address. Remove it and add it again.",
};

function isPublicHttpsAddress(address: string): boolean {
  try {
    return new URL(address).protocol === "https:";
  } catch {
    return false;
  }
}

function check(
  input: AnnouncementInput,
): { ok: true; title: string; description: string; images: string[] } | { ok: false; reason: InputRefusal } {
  const title = input.title.trim();
  const description = input.description.trim();

  if (!title) return { ok: false, reason: "empty-title" };
  if (title.length > TITLE_LIMIT) return { ok: false, reason: "title-too-long" };
  if (!description) return { ok: false, reason: "empty-description" };

  const images = input.images ?? [];
  if (!images.every(isPublicHttpsAddress)) return { ok: false, reason: "invalid-image" };

  return { ok: true, title, description, images };
}

/**
 * The audit trail is a record of what happened, not a gate on it: a change that is already saved is
 * not undone because audit-logs could not be reached.
 */
async function audited({ audit }: Ports, event: AuditEvent) {
  try {
    await audit.record(event);
  } catch (error) {
    console.error("Announcement action could not be audited", error);
  }
}

/** Saves a Draft. Every Staff member with the Marketing Module shares every Announcement. */
export async function saveDraft(sql: postgres.Sql, actor: Actor, input: AnnouncementInput, ports: Ports): Promise<SaveResult> {
  const checked = check(input);
  if (!checked.ok) return checked;

  const at = ports.now();

  const [{ id }] = await sql<{ id: string }[]>`
    insert into crms.announcements (title, description, images, created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at)
    values (${checked.title}, ${checked.description}, ${checked.images}, ${actor.id}, ${actor.name}, ${actor.id}, ${actor.name}, ${at}, ${at})
    returning id`;

  await audited(ports, {
    action: "record.created",
    actor,
    announcement: { id, title: checked.title },
    description: `${actor.name} saved the Draft "${checked.title}".`,
    occurredAt: ports.now(),
  });

  return { ok: true, announcement: { id } };
}

/** Why a Draft change matched nothing: it never existed, or it has moved on from Draft. */
async function whyNotDraft(sql: postgres.Sql, id: string): Promise<"not-found" | "not-a-draft"> {
  const [row] = await sql`select 1 from crms.announcements where id = ${id}`;

  return row ? "not-a-draft" : "not-found";
}

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Edits a Draft, whoever wrote it. Only a Draft changes this way: Sent is final. */
export async function editDraft(sql: postgres.Sql, actor: Actor, id: string, input: AnnouncementInput, ports: Ports): Promise<EditResult> {
  const checked = check(input);
  if (!checked.ok) return checked;
  if (!isUuid(id)) return { ok: false, reason: "not-found" };

  const [row] = await sql<{ id: string }[]>`
    update crms.announcements
    set title = ${checked.title}, description = ${checked.description}, images = ${checked.images},
        updated_by_id = ${actor.id}, updated_by_name = ${actor.name}, updated_at = ${ports.now()}
    where id = ${id} and state = 'draft'
    returning id`;

  if (!row) return { ok: false, reason: await whyNotDraft(sql, id) };

  await audited(ports, {
    action: "record.updated",
    actor,
    announcement: { id, title: checked.title },
    description: `${actor.name} edited the Draft "${checked.title}".`,
    occurredAt: ports.now(),
  });

  return { ok: true };
}

/** Deletes a Draft, whoever wrote it. */
export async function deleteDraft(sql: postgres.Sql, actor: Actor, id: string, ports: Ports): Promise<DeleteResult> {
  if (!isUuid(id)) return { ok: false, reason: "not-found" };

  const [row] = await sql<{ title: string }[]>`
    delete from crms.announcements where id = ${id} and state = 'draft' returning title`;

  if (!row) return { ok: false, reason: await whyNotDraft(sql, id) };

  await audited(ports, {
    action: "record.deleted",
    actor,
    announcement: { id, title: row.title },
    description: `${actor.name} deleted the Draft "${row.title}".`,
    occurredAt: ports.now(),
  });

  return { ok: true };
}

const SELECT = (sql: postgres.Sql) => sql`
  select a.id, a.title, a.description, a.images, a.state, a.scheduled_for, a.sent_at,
    a.created_by_name, a.updated_by_name, a.updated_at,
    nullif((select count(*) from crms.announcement_recipients r where r.announcement_id = a.id), 0)::int as sent_to
  from crms.announcements a`;

function toRow(r: Record<string, unknown>): AnnouncementRow {
  return {
    id: r.id as string,
    title: r.title as string,
    description: r.description as string,
    images: r.images as string[],
    state: r.state as AnnouncementState,
    scheduledFor: r.scheduled_for as Date | null,
    sentAt: r.state === "sent" ? (r.sent_at as Date | null) : null,
    sentTo: r.sent_to as number | null,
    createdByName: r.created_by_name as string,
    updatedByName: r.updated_by_name as string,
    updatedAt: r.updated_at as Date,
  };
}

/** Every Announcement, the most recently changed first. */
export async function listAnnouncements(sql: postgres.Sql): Promise<AnnouncementRow[]> {
  const rows = await sql<Record<string, unknown>[]>`${SELECT(sql)} order by a.updated_at desc, a.id`;

  return rows.map(toRow);
}

export async function getAnnouncement(sql: postgres.Sql, id: string): Promise<AnnouncementRow | null> {
  if (!isUuid(id)) return null;

  const [row] = await sql<Record<string, unknown>[]>`${SELECT(sql)} where a.id = ${id}`;

  return row ? toRow(row) : null;
}

/** Subscribers (verified Customers who said yes to marketing) out of every verified Customer. Reads the storefront's data. */
export async function subscriberCount(sql: postgres.Sql): Promise<{ subscribers: number; customers: number }> {
  const [row] = await sql<{ subscribers: number; customers: number }[]>`
    select (count(*) filter (where c.marketing_opt_in))::int as subscribers, count(*)::int as customers
    from customers c
    join neon_auth."user" u on u.id::text = c.id and u."emailVerified"`;

  return row;
}

export const plural = (n: number) => `${n} Subscriber${n === 1 ? "" : "s"}`;

/**
 * Sends to every Subscriber at this moment, skipping any this Announcement was already handed to. While it
 * runs, sent_at holds the start time as the claim that stops a second send; it is cleared if the send
 * fails, and set to the time it finished when it succeeds.
 */
async function deliver(
  sql: postgres.Sql,
  actor: Actor,
  id: string,
  from: AnnouncementState[],
  ports: Ports,
): Promise<SendResult> {
  if (!isUuid(id)) return { ok: false, reason: "not-found" };

  const current = await getAnnouncement(sql, id);
  if (!current) return { ok: false, reason: "not-found" };
  if (!from.includes(current.state)) return { ok: false, reason: "not-sendable" };

  const audience = await ports.subscribers.list();
  if (audience.length === 0 && (await reachedCustomers(sql, id)).size === 0) return { ok: false, reason: "no-subscribers" };

  const startedAt = ports.now();
  const [claimed] = await sql<{ id: string }[]>`
    update crms.announcements set sent_at = ${startedAt}
    where id = ${id} and state = any(${from}) and (sent_at is null or sent_at < ${new Date(startedAt.getTime() - STALE_SEND_MS)})
    returning id`;

  if (!claimed) return { ok: false, reason: (await getAnnouncement(sql, id)) ? "in-progress" : "not-found" };

  // Read after the claim: a send that finished just before it has already recorded who it reached.
  const reachedBefore = await reachedCustomers(sql, id);
  const mail: MarketingMail = { title: current.title, description: current.description, images: current.images };
  const remaining = audience.filter((s) => !reachedBefore.has(s.customerId));
  let complete = true;

  try {
    for (let i = 0; i < remaining.length; i += SEND_BATCH_SIZE) {
      const batch = remaining.slice(i, i + SEND_BATCH_SIZE);

      try {
        const handedOver = await ports.mailer.sendBatch(mail, batch);
        if (handedOver.length > 0) await recordHandedOver(sql, id, handedOver, ports.now());
        if (handedOver.length < batch.length) complete = false;
      } catch (error) {
        console.error("An Announcement batch could not be handed over", error);
        complete = false;
      }
    }
  } finally {
    await sql`
      update crms.announcements set state = ${complete ? "sent" : "failed"}, sent_at = ${complete ? ports.now() : null}, updated_at = ${ports.now()},
        updated_by_id = ${actor.id}, updated_by_name = ${actor.name}
      where id = ${id}`;
  }

  const state = complete ? "sent" : "failed";
  const reached = (await getAnnouncement(sql, id))?.sentTo ?? 0;

  await audited(ports, {
    action: "record.updated",
    actor,
    announcement: { id, title: current.title },
    description: complete
      ? `${actor.name} sent "${current.title}" to ${plural(audience.length)}.`
      : `${actor.name} tried to send "${current.title}" to ${plural(audience.length)}; ${reached} ${reached === 1 ? "was" : "were"} reached and it is Failed.`,
    subscribers: audience.length,
    occurredAt: ports.now(),
  });

  return { ok: true, state, subscribers: audience.length };
}

async function reachedCustomers(sql: postgres.Sql, id: string): Promise<Set<string>> {
  const rows = await sql<{ customer_id: string }[]>`select customer_id from crms.announcement_recipients where announcement_id = ${id}`;

  return new Set(rows.map((r) => r.customer_id));
}

async function recordHandedOver(sql: postgres.Sql, id: string, handedOver: Subscriber[], at: Date) {
  await sql`
    insert into crms.announcement_recipients (announcement_id, customer_id, handed_over_at)
    select ${id}, customer_id, ${at} from unnest(${handedOver.map((s) => s.customerId)}::text[]) as customer_id
    on conflict do nothing`;
}

/** Sends a Draft or Scheduled Announcement now, to every Subscriber. Sent is final; Failed can be retried. */
export function sendNow(sql: postgres.Sql, actor: Actor, id: string, ports: Ports): Promise<SendResult> {
  return deliver(sql, actor, id, ["draft", "scheduled"], ports);
}

/** Finishes a Failed send. Subscribers it already reached are skipped. */
export function retrySend(sql: postgres.Sql, actor: Actor, id: string, ports: Ports): Promise<SendResult> {
  return deliver(sql, actor, id, ["failed"], ports);
}

/** Every Subscriber now: verified Customers who said yes to marketing. Walk-in Customers and Leads have no verified account. */
export const storefrontSubscribers = (sql: postgres.Sql): SubscriberSource => ({
  async list() {
    const rows = await sql<{ id: string; email: string }[]>`
      select c.id, c.email
      from customers c
      join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
      where c.marketing_opt_in
      order by c.id`;

    return rows.map((r) => ({ customerId: r.id, email: r.email }));
  },
});
