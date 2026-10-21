import type postgres from "postgres";

import { defaultLayout, isImageLayout, layoutsFor, type ImageLayout } from "./image-layouts";

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
  occurredAt: Date;
}

/** The audit-logs boundary, reached through the api-gateway (see lib/gateway.ts). Tests replace it with a fake. */
export interface AuditLog {
  record(event: AuditEvent): Promise<void>;
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
  now: () => Date;
}

export type InputRefusal = "empty-title" | "title-too-long" | "empty-description" | "layout-mismatch";

export type SaveResult = { ok: true; announcement: { id: string } } | { ok: false; reason: InputRefusal };
export type EditResult = { ok: true } | { ok: false; reason: InputRefusal | "not-found" | "not-a-draft" };
export type TestCopyResult = { ok: true } | { ok: false; reason: "not-found" | "send-failed" };
export type DeleteResult = { ok: true } | { ok: false; reason: "not-found" | "not-a-draft" };

export const INPUT_REFUSALS: Record<InputRefusal, string> = {
  "empty-title": "Give the Announcement a title.",
  "title-too-long": `Keep the title to ${TITLE_LIMIT} characters or fewer, so the subject is not cut off.`,
  "empty-description": "Write a description.",
  "layout-mismatch": "That layout does not fit the number of images. Pick another.",
};

/** A layout must be one that holds exactly the images the Announcement has; null is always allowed. */
const fits = (layout: ImageLayout | null | undefined, imageCount: number) =>
  !layout || layoutsFor(imageCount).includes(layout);

function check(input: AnnouncementInput): { ok: true; title: string; description: string } | { ok: false; reason: InputRefusal } {
  const title = input.title.trim();
  const description = input.description.trim();

  if (!title) return { ok: false, reason: "empty-title" };
  if (title.length > TITLE_LIMIT) return { ok: false, reason: "title-too-long" };
  if (!description) return { ok: false, reason: "empty-description" };

  return { ok: true, title, description };
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

/** Saves a text-only Draft. Every Staff member with the Marketing Module shares every Announcement. */
export async function saveDraft(sql: postgres.Sql, actor: Actor, input: AnnouncementInput, ports: Ports): Promise<SaveResult> {
  const checked = check(input);
  if (!checked.ok) return checked;
  // A new Draft has no images yet, so there is nothing for a layout to lay out.
  if (!fits(input.imageLayout, 0)) return { ok: false, reason: "layout-mismatch" };

  const at = ports.now();

  const [{ id }] = await sql<{ id: string }[]>`
    insert into crms.announcements (title, description, created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at)
    values (${checked.title}, ${checked.description}, ${actor.id}, ${actor.name}, ${actor.id}, ${actor.name}, ${at}, ${at})
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

  const [current] = await sql<{ images: string[]; image_layout: string | null; state: AnnouncementState }[]>`
    select images, image_layout, state from crms.announcements where id = ${id}`;
  if (!current) return { ok: false, reason: "not-found" };
  if (current.state !== "draft") return { ok: false, reason: "not-a-draft" };

  const imageLayout = input.imageLayout === undefined ? current.image_layout : input.imageLayout;
  if (!fits(imageLayout as ImageLayout | null, current.images.length)) return { ok: false, reason: "layout-mismatch" };

  const [row] = await sql<{ id: string }[]>`
    update crms.announcements
    set title = ${checked.title}, description = ${checked.description}, image_layout = ${imageLayout},
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
  select a.id, a.title, a.description, a.images, a.image_layout, a.state, a.scheduled_for, a.sent_at,
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
    sentAt: r.sent_at as Date | null,
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
