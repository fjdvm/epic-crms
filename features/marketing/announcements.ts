import type postgres from "postgres";

import { defaultLayout, isImageLayout, layoutsFor, type ImageLayout } from "./image-layouts";
import type { ImageStore } from "./image-limits";
import { formatPhilippineTime } from "./philippine-time";

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
  /** How the images are arranged. Left out, an edit keeps the current choice; null goes back to the default. */
  imageLayout?: ImageLayout | null;
}

export interface AnnouncementRow {
  id: string;
  title: string;
  description: string;
  /** Public HTTPS addresses, in order. Empty for a text-only Announcement. */
  images: string[];
  /** The layout the email uses: Staff's choice if it still suits the images, else the default. Null with no images. */
  imageLayout: ImageLayout | null;
  state: AnnouncementState;
  scheduledFor: Date | null;
  /** The Staff member who scheduled it, while it is Scheduled. */
  scheduledByName: string | null;
  sentAt: Date | null;
  /** Customers it was handed to; null until something has been handed over. */
  sentTo: number | null;
  createdByName: string;
  updatedByName: string;
  updatedAt: Date;
}

/** What the audit-logs service is told about a Staff action; the gateway adapter fills in the rest. */
export interface AuditEvent {
  action: "record.created" | "record.updated" | "record.deleted" | "record.viewed";
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
export interface MarketingContent {
  title: string;
  description: string;
  images: string[];
  imageLayout: ImageLayout | null;
}

/**
 * Hands one batch (at most SEND_BATCH_SIZE) to the notifications service, through the api-gateway, with each
 * Subscriber's own Unsubscribe link. Resolves with the Subscribers it was handed over to; throws if none were.
 */
export interface MarketingMailer {
  sendBatch(mail: MarketingContent, to: Subscriber[]): Promise<Subscriber[]>;
}


/** One Marketing Email for one address, as the notifications service takes it. */
export interface MarketingMessage {
  to: string;
  title: string;
  body: string;
  images: string[];
  imageLayout: ImageLayout | null;
}

/**
 * The notifications service's marketing email, reached through the api-gateway (see lib/gateway.ts).
 * Tests replace it with a fake. It must throw when the gateway does not accept the email.
 */
export interface MarketingMail {
  sendOne(message: MarketingMessage): Promise<void>;
}

export interface Ports {
  audit: AuditLog;
  mail: MarketingMail;
  images: ImageStore;
  subscribers: SubscriberSource;
  mailer: MarketingMailer;
  now: () => Date;
}

/** What sending to Subscribers needs; the scheduled job has no use for the rest. */
export type SendPorts = Pick<Ports, "audit" | "subscribers" | "mailer" | "now">;

/** The most recipients the notifications service accepts in one batch. */
export const SEND_BATCH_SIZE = 100;

/** A send that has not finished after this long is taken to have died, and may be started again. */
const STALE_SEND_MS = 10 * 60 * 1000;

export type InputRefusal = "empty-title" | "title-too-long" | "empty-description" | "invalid-image" | "layout-mismatch";

export type SaveResult = { ok: true; announcement: { id: string } } | { ok: false; reason: InputRefusal };
export type EditResult = { ok: true } | { ok: false; reason: InputRefusal | "not-found" | "not-editable" };
export type TestCopyResult = { ok: true } | { ok: false; reason: "not-found" | "send-failed" };
export type ScheduleResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "not-schedulable" | "in-the-past" | "invalid-time" | "in-progress" };
export type CancelScheduleResult = { ok: true } | { ok: false; reason: "not-found" | "not-scheduled" | "in-progress" };
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

export const SCHEDULE_REFUSALS: Record<Exclude<ScheduleResult, { ok: true }>["reason"], string> = {
  "not-found": "That Announcement no longer exists.",
  "not-schedulable": "Only a Draft or a Scheduled Announcement can be scheduled.",
  "in-the-past": "Pick a time in the future, in Philippine Time.",
  "invalid-time": "That is not a valid date and time.",
  "in-progress": "That Announcement is being sent right now. Check the list in a moment.",
};

export const CANCEL_SCHEDULE_REFUSALS: Record<Exclude<CancelScheduleResult, { ok: true }>["reason"], string> = {
  "not-found": "That Announcement no longer exists.",
  "not-scheduled": "That Announcement is no longer Scheduled.",
  "in-progress": "That Announcement is being sent right now. Check the list in a moment.",
};

export const INPUT_REFUSALS: Record<InputRefusal, string> = {
  "empty-title": "Give the Announcement a title.",
  "title-too-long": `Keep the title to ${TITLE_LIMIT} characters or fewer, so the subject is not cut off.`,
  "empty-description": "Write a description.",
  "invalid-image": "One of the images is not a valid image address. Remove it and add it again.",
  "layout-mismatch": "That layout does not fit the number of images. Pick another.",
};

/** A layout must be one that holds exactly the images the Announcement has; null is always allowed. */
const fits = (layout: ImageLayout | null | undefined, imageCount: number) =>
  !layout || layoutsFor(imageCount).includes(layout);

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
async function audited({ audit }: Pick<Ports, "audit">, event: AuditEvent) {
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
  if (!fits(input.imageLayout, checked.images.length)) return { ok: false, reason: "layout-mismatch" };

  const at = ports.now();

  const [{ id }] = await sql<{ id: string }[]>`
    insert into crms.announcements (title, description, images, image_layout, created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at)
    values (${checked.title}, ${checked.description}, ${checked.images}, ${input.imageLayout ?? null}, ${actor.id}, ${actor.name}, ${actor.id}, ${actor.name}, ${at}, ${at})
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

/** No send is running: sent_at holds the claim of one, and counts only until it has gone stale. */
const notSending = (sql: postgres.Sql, at: Date) => sql`(sent_at is null or sent_at < ${new Date(at.getTime() - STALE_SEND_MS)})`;

/** Edits a Draft or a Scheduled Announcement, whoever wrote it; a Scheduled one stays Scheduled. Sent and Failed are not edited. */
export async function editDraft(sql: postgres.Sql, actor: Actor, id: string, input: AnnouncementInput, ports: Ports): Promise<EditResult> {
  const checked = check(input);
  if (!checked.ok) return checked;
  if (!isUuid(id)) return { ok: false, reason: "not-found" };

  // A choice must fit the images being saved. An edit that does not mention it keeps what is stored,
  // which reads back as the default if the images no longer suit it.
  if (input.imageLayout !== undefined && !fits(input.imageLayout, checked.images.length)) return { ok: false, reason: "layout-mismatch" };

  const [row] = await sql<{ id: string; state: AnnouncementState }[]>`
    update crms.announcements
    set title = ${checked.title}, description = ${checked.description}, images = ${checked.images},
        image_layout = ${input.imageLayout === undefined ? sql`image_layout` : input.imageLayout},
        updated_by_id = ${actor.id}, updated_by_name = ${actor.name}, updated_at = ${ports.now()}
    where id = ${id} and state in ('draft', 'scheduled') and ${notSending(sql, ports.now())}
    returning id, state`;

  if (!row) return { ok: false, reason: (await whyNotDraft(sql, id)) === "not-found" ? "not-found" : "not-editable" };

  await audited(ports, {
    action: "record.updated",
    actor,
    announcement: { id, title: checked.title },
    description: `${actor.name} edited the ${row.state === "scheduled" ? "Scheduled Announcement" : "Draft"} "${checked.title}".`,
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
  select a.id, a.title, a.description, a.images, a.image_layout, a.state, a.scheduled_for, a.scheduled_by_name, a.sent_at,
    a.created_by_name, a.updated_by_name, a.updated_at,
    nullif((select count(*) from crms.announcement_recipients r where r.announcement_id = a.id), 0)::int as sent_to
  from crms.announcements a`;

function toRow(r: Record<string, unknown>): AnnouncementRow {
  const images = r.images as string[];
  const chosen = isImageLayout(r.image_layout) ? r.image_layout : null;

  return {
    id: r.id as string,
    title: r.title as string,
    description: r.description as string,
    images,
    imageLayout: chosen && fits(chosen, images.length) ? chosen : defaultLayout(images.length),
    state: r.state as AnnouncementState,
    scheduledFor: r.scheduled_for as Date | null,
    scheduledByName: r.scheduled_by_name as string | null,
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

/** An Announcement as one Customer was sent it: what they received, and when it was handed over to them. */
export interface EmailReceived {
  id: string;
  title: string;
  description: string;
  images: string[];
  imageLayout: ImageLayout | null;
  receivedAt: Date;
}

/** The Announcements this Customer was handed, newest first. A test copy is never recorded against a Customer, so it never appears. */
export async function listEmailsReceived(sql: postgres.Sql, customerId: string): Promise<EmailReceived[]> {
  const rows = await sql<Record<string, unknown>[]>`
    select a.id, a.title, a.description, a.images, a.image_layout, r.handed_over_at
    from crms.announcement_recipients r
    join crms.announcements a on a.id = r.announcement_id
    where r.customer_id = ${customerId}
    order by r.handed_over_at desc, a.id`;

  return rows.map((r) => {
    const { title, description, images, imageLayout } = toRow({ ...r, state: "sent" });

    return { id: r.id as string, title, description, images, imageLayout, receivedAt: r.handed_over_at as Date };
  });
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
  ports: SendPorts,
  /** A send the job makes for the Staff member who scheduled it, rather than one Staff start. */
  scheduled = false,
): Promise<SendResult> {
  if (!isUuid(id)) return { ok: false, reason: "not-found" };

  const current = await getAnnouncement(sql, id);
  if (!current) return { ok: false, reason: "not-found" };
  if (!from.includes(current.state)) return { ok: false, reason: "not-sendable" };

  const audience = await ports.subscribers.list();
  if (audience.length === 0 && (await reachedCustomers(sql, id)).size === 0) {
    if (!scheduled) return { ok: false, reason: "no-subscribers" };

    // Nobody is there to ask, so a scheduled send that finds no Subscribers is Failed rather than tried again every run.
    const [failed] = await sql<{ id: string }[]>`
      update crms.announcements set state = 'failed', updated_at = ${ports.now()}, updated_by_id = ${actor.id}, updated_by_name = ${actor.name}
      where id = ${id} and state = 'scheduled' and ${notSending(sql, ports.now())}
      returning id`;
    if (!failed) return { ok: false, reason: "in-progress" };

    await audited(ports, {
      action: "record.updated",
      actor,
      announcement: { id, title: current.title },
      description: `${actor.name}'s scheduled send of "${current.title}" found no Subscribers, so nothing was sent and it is Failed.`,
      subscribers: 0,
      occurredAt: ports.now(),
    });

    return { ok: true, state: "failed", subscribers: 0 };
  }

  const startedAt = ports.now();
  const [claimed] = await sql<{ id: string }[]>`
    update crms.announcements set sent_at = ${startedAt}
    where id = ${id} and state = any(${from}) and (sent_at is null or sent_at < ${new Date(startedAt.getTime() - STALE_SEND_MS)})
      and (${!scheduled} or scheduled_for <= ${startedAt})
    returning id`;

  if (!claimed) return { ok: false, reason: (await getAnnouncement(sql, id)) ? "in-progress" : "not-found" };

  // Read after the claim: a send that finished just before it has already recorded who it reached.
  const reachedBefore = await reachedCustomers(sql, id);
  // Edits are refused once the claim is held, so the content read now is what goes out, not what was there before it.
  const latest = (await getAnnouncement(sql, id)) ?? current;
  const mail: MarketingContent = { title: latest.title, description: latest.description, images: latest.images, imageLayout: latest.imageLayout };
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
      where id = ${id} and sent_at = ${startedAt}`;
  }

  const state = complete ? "sent" : "failed";
  const reached = (await getAnnouncement(sql, id))?.sentTo ?? 0;

  await audited(ports, {
    action: "record.updated",
    actor,
    announcement: { id, title: current.title },
    description: scheduled
      ? complete
        ? `${actor.name}'s scheduled send of "${current.title}" went to ${plural(audience.length)}.`
        : `${actor.name}'s scheduled send of "${current.title}" to ${plural(audience.length)} did not finish; ${reached} ${reached === 1 ? "was" : "were"} reached and it is Failed.`
      : complete
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

/** Schedules a Draft, or reschedules a Scheduled Announcement, for a time in the future. Whoever does it is who the send is audited as. */
export async function schedule(sql: postgres.Sql, actor: Actor, id: string, at: Date, ports: Ports): Promise<ScheduleResult> {
  if (!isUuid(id)) return { ok: false, reason: "not-found" };
  if (Number.isNaN(at.getTime())) return { ok: false, reason: "invalid-time" };
  if (at.getTime() <= ports.now().getTime()) return { ok: false, reason: "in-the-past" };

  const before = await getAnnouncement(sql, id);
  if (!before) return { ok: false, reason: "not-found" };

  const [row] = await sql<{ id: string }[]>`
    update crms.announcements
    set state = 'scheduled', scheduled_for = ${at}, scheduled_by_id = ${actor.id}, scheduled_by_name = ${actor.name},
        updated_by_id = ${actor.id}, updated_by_name = ${actor.name}, updated_at = ${ports.now()}
    where id = ${id} and state in ('draft', 'scheduled') and ${notSending(sql, ports.now())}
    returning id`;

  if (!row) {
    const now = await getAnnouncement(sql, id);

    return { ok: false, reason: !now ? "not-found" : now.state === "draft" || now.state === "scheduled" ? "in-progress" : "not-schedulable" };
  }

  await audited(ports, {
    action: "record.updated",
    actor,
    announcement: { id, title: before.title },
    description: `${actor.name} ${before.state === "scheduled" ? "rescheduled" : "scheduled"} "${before.title}" for ${formatPhilippineTime(at)} Philippine Time.`,
    occurredAt: ports.now(),
  });

  return { ok: true };
}

/** Takes a Scheduled Announcement back to a Draft, with no send time. */
export async function cancelSchedule(sql: postgres.Sql, actor: Actor, id: string, ports: Ports): Promise<CancelScheduleResult> {
  if (!isUuid(id)) return { ok: false, reason: "not-found" };

  const [row] = await sql<{ title: string }[]>`
    update crms.announcements
    set state = 'draft', scheduled_for = null, scheduled_by_id = null, scheduled_by_name = null,
        updated_by_id = ${actor.id}, updated_by_name = ${actor.name}, updated_at = ${ports.now()}
    where id = ${id} and state = 'scheduled' and ${notSending(sql, ports.now())}
    returning title`;

  if (!row) {
    const now = await getAnnouncement(sql, id);

    return { ok: false, reason: !now ? "not-found" : now.state === "scheduled" ? "in-progress" : "not-scheduled" };
  }

  await audited(ports, {
    action: "record.updated",
    actor,
    announcement: { id, title: row.title },
    description: `${actor.name} cancelled the schedule of "${row.title}"; it is a Draft again.`,
    occurredAt: ports.now(),
  });

  return { ok: true };
}

export interface DueRun {
  sent: number;
  failed: number;
  /** Due, but another run has it or it has just been sent. */
  skipped: number;
  /** Due, but the Subscribers could not be read; it stays Scheduled for the next run. */
  unreadable: number;
}

/**
 * The recurring job: sends every Scheduled Announcement whose time has come, to whoever is a Subscriber now,
 * as the Staff member who scheduled it. Safe to run twice at once, because each send claims its Announcement
 * first (see deliver), so a second run finds it in progress or already Sent.
 */
export async function sendDue(sql: postgres.Sql, ports: SendPorts): Promise<DueRun> {
  const due = await sql<{ id: string; scheduled_by_id: string | null; scheduled_by_name: string | null }[]>`
    select id, scheduled_by_id, scheduled_by_name from crms.announcements
    where state = 'scheduled' and scheduled_for <= ${ports.now()}
    order by scheduled_for, id`;
  const run: DueRun = { sent: 0, failed: 0, skipped: 0, unreadable: 0 };

  for (const row of due) {
    const actor = { id: row.scheduled_by_id ?? "schedule", name: row.scheduled_by_name ?? "Scheduled send" };

    try {
      const result = await deliver(sql, actor, row.id, ["scheduled"], ports, true);

      if (!result.ok) run.skipped++;
      else if (result.state === "sent") run.sent++;
      else run.failed++;
    } catch (error) {
      console.error("A scheduled Announcement could not be sent", error);
      run.unreadable++;
    }
  }

  return run;
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

/**
 * Emails the real Marketing Email to the Staff member's own address, whatever state the Announcement
 * is in. It goes to no one else and is not recorded against any Customer, so the Announcement is unchanged.
 */
export async function sendTestCopy(
  sql: postgres.Sql,
  actor: Actor,
  staffEmail: string,
  id: string,
  ports: Ports,
): Promise<TestCopyResult> {
  const announcement = await getAnnouncement(sql, id);
  if (!announcement) return { ok: false, reason: "not-found" };

  try {
    await ports.mail.sendOne({
      to: staffEmail,
      title: announcement.title,
      body: announcement.description,
      images: announcement.images,
      imageLayout: announcement.imageLayout,
    });
  } catch (error) {
    console.error("A test copy could not be sent", error);

    return { ok: false, reason: "send-failed" };
  }

  await audited(ports, {
    action: "record.viewed",
    actor,
    announcement: { id, title: announcement.title },
    description: `${actor.name} sent themselves a test copy of "${announcement.title}".`,
    occurredAt: ports.now(),
  });

  return { ok: true };
}
