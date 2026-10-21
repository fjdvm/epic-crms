import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import sharp from "sharp";

import { addImage } from "@/features/marketing/add-image";
import { MAX_IMAGE_BYTES, type ImageStore } from "@/features/marketing/image-limits";
import {
  deleteDraft,
  editDraft,
  getAnnouncement,
  listAnnouncements,
  saveDraft,
  subscriberCount,
  TITLE_LIMIT,
  type AuditEvent,
  type AuditLog,
} from "@/features/marketing/announcements";

import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

/** The real crms DDL for Announcements, minus the schema creation PGlite already has. */
function announcementStatements(): string[] {
  return readFileSync("docs/db/crms-announcements.sql", "utf8")
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  for (const statement of announcementStatements()) await db.sql.unsafe(statement);
}, 60_000);

afterAll(async () => {
  await db.close();
});

class FakeAudit implements AuditLog {
  events: AuditEvent[] = [];
  down = false;

  async record(event: AuditEvent) {
    if (this.down) throw new Error("audit-logs is down");
    this.events.push(event);
  }
}

/** In-memory file storage: every stored image gets a public address, and tests can make it fail. */
class FakeImageStore implements ImageStore {
  stored = new Map<string, { contentType: string; bytes: Uint8Array }>();
  down = false;

  async store(image: { contentType: "image/jpeg"; bytes: Uint8Array }) {
    if (this.down) throw new Error("file-storage is down");
    const url = `https://cdn.test/images/${this.stored.size + 1}.jpg`;
    this.stored.set(url, image);

    return url;
  }
}

const ada = { id: "ada", name: "Ada Okafor" };
const ben = { id: "ben", name: "Ben Cruz" };
const now = new Date("2026-10-20T04:00:00Z");

let audit: FakeAudit;
let images: FakeImageStore;
const ports = () => ({ audit, images, now: () => now });

beforeEach(async () => {
  audit = new FakeAudit();
  images = new FakeImageStore();
  await db.sql`truncate crms.announcements cascade`;
  await db.sql`truncate customers cascade`;
  await db.sql`truncate neon_auth."user" cascade`;
});

const draft = { title: "Undas ube treats", description: "Our ube treats are back for Undas." };

describe("saving a Draft", () => {
  it("stores a text-only Draft naming who saved it", async () => {
    const result = await saveDraft(db.sql, ada, draft, ports());

    expect(result.ok).toBe(true);
    const saved = (await listAnnouncements(db.sql))[0];
    expect(saved).toMatchObject({
      title: "Undas ube treats",
      description: "Our ube treats are back for Undas.",
      state: "draft",
      images: [],
      sentTo: null,
      sentAt: null,
      updatedByName: "Ada Okafor",
    });
  });

  it("trims the title and description", async () => {
    await saveDraft(db.sql, ada, { title: "  Halaya  ", description: "  Restocked.\n" }, ports());

    expect(await listAnnouncements(db.sql)).toMatchObject([{ title: "Halaya", description: "Restocked." }]);
  });

  it.each([
    ["an empty title", { ...draft, title: "   " }, "empty-title"],
    ["a title over the limit", { ...draft, title: "x".repeat(TITLE_LIMIT + 1) }, "title-too-long"],
    ["an empty description", { ...draft, description: "" }, "empty-description"],
  ])("refuses %s and stores nothing", async (_name, input, reason) => {
    expect(await saveDraft(db.sql, ada, input, ports())).toEqual({ ok: false, reason });
    expect(await listAnnouncements(db.sql)).toEqual([]);
    expect(audit.events).toEqual([]);
  });

  it("accepts a title of exactly the limit", async () => {
    expect((await saveDraft(db.sql, ada, { ...draft, title: "x".repeat(TITLE_LIMIT) }, ports())).ok).toBe(true);
  });

  it("is audited with the acting Staff member", async () => {
    const result = await saveDraft(db.sql, ada, draft, ports());
    if (!result.ok) throw new Error("not saved");

    expect(audit.events).toEqual([
      {
        action: "record.created",
        actor: ada,
        announcement: { id: result.announcement.id, title: "Undas ube treats" },
        description: 'Ada Okafor saved the Draft "Undas ube treats".',
        occurredAt: now,
      },
    ]);
  });

  it("still saves when the audit log is down", async () => {
    audit.down = true;

    expect((await saveDraft(db.sql, ada, draft, ports())).ok).toBe(true);
    expect(await listAnnouncements(db.sql)).toHaveLength(1);
  });
});

describe("editing a Draft", () => {
  async function saved() {
    const result = await saveDraft(db.sql, ada, draft, ports());
    if (!result.ok) throw new Error("not saved");
    audit.events = [];

    return result.announcement.id;
  }

  it("changes the title and description", async () => {
    const id = await saved();

    expect((await editDraft(db.sql, ada, id, { title: "New", description: "Changed." }, ports())).ok).toBe(true);
    expect(await getAnnouncement(db.sql, id)).toMatchObject({ title: "New", description: "Changed." });
  });

  it("lets a colleague edit it and records them as the last editor", async () => {
    const id = await saved();

    await editDraft(db.sql, ben, id, { title: "Ben's title", description: "Ben's words." }, ports());

    expect(await getAnnouncement(db.sql, id)).toMatchObject({
      createdByName: "Ada Okafor",
      updatedByName: "Ben Cruz",
    });
    expect(audit.events[0]).toMatchObject({ action: "record.updated", actor: ben });
  });

  it("refuses an invalid edit and leaves the Draft as it was", async () => {
    const id = await saved();

    expect(await editDraft(db.sql, ada, id, { title: "", description: "x" }, ports())).toEqual({
      ok: false,
      reason: "empty-title",
    });
    expect(await getAnnouncement(db.sql, id)).toMatchObject({ title: "Undas ube treats" });
    expect(audit.events).toEqual([]);
  });

  it("says so when the Announcement does not exist", async () => {
    expect(
      await editDraft(db.sql, ada, "00000000-0000-0000-0000-000000000000", draft, ports()),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("refuses to edit an Announcement that has been Sent", async () => {
    const id = await saved();
    await db.sql`update crms.announcements set state = 'sent', sent_at = now() where id = ${id}`;

    expect(await editDraft(db.sql, ada, id, { title: "Sneaky", description: "x" }, ports())).toEqual({
      ok: false,
      reason: "not-a-draft",
    });
    expect(await getAnnouncement(db.sql, id)).toMatchObject({ title: "Undas ube treats", state: "sent" });
    expect(audit.events).toEqual([]);
  });
});

describe("deleting a Draft", () => {
  async function saved(by = ada) {
    const result = await saveDraft(db.sql, by, draft, ports());
    if (!result.ok) throw new Error("not saved");
    audit.events = [];

    return result.announcement.id;
  }

  it("removes it, including a colleague's, and audits who did it", async () => {
    const id = await saved(ada);

    expect(await deleteDraft(db.sql, ben, id, ports())).toEqual({ ok: true });
    expect(await getAnnouncement(db.sql, id)).toBeNull();
    expect(audit.events).toEqual([
      {
        action: "record.deleted",
        actor: ben,
        announcement: { id, title: "Undas ube treats" },
        description: 'Ben Cruz deleted the Draft "Undas ube treats".',
        occurredAt: now,
      },
    ]);
  });

  it("will not delete one that is no longer a Draft", async () => {
    const id = await saved();
    await db.sql`update crms.announcements set state = 'scheduled', scheduled_for = now() where id = ${id}`;

    expect(await deleteDraft(db.sql, ada, id, ports())).toEqual({ ok: false, reason: "not-a-draft" });
    expect(await getAnnouncement(db.sql, id)).not.toBeNull();
    expect(audit.events).toEqual([]);
  });

  it("says so when it is already gone", async () => {
    const id = await saved();
    await deleteDraft(db.sql, ada, id, ports());

    expect(await deleteDraft(db.sql, ben, id, ports())).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("listing Announcements", () => {
  it("shows the newest change first, with how many Customers each reached", async () => {
    const first = await saveDraft(db.sql, ada, { title: "First", description: "a" }, ports());
    const second = await saveDraft(db.sql, ada, { title: "Second", description: "b" }, ports());
    if (!first.ok || !second.ok) throw new Error("not saved");
    await db.sql`insert into customers (id, full_name, email) values ('c1', 'A', 'a@x.test'), ('c2', 'B', 'b@x.test')`;
    await db.sql`update crms.announcements set state = 'sent', sent_at = '2026-10-01T02:00:00Z', updated_at = '2026-10-01T02:00:00Z' where id = ${first.announcement.id}`;
    await db.sql`insert into crms.announcement_recipients (announcement_id, customer_id) values (${first.announcement.id}, 'c1'), (${first.announcement.id}, 'c2')`;

    const list = await listAnnouncements(db.sql);

    expect(list.map((a) => [a.title, a.state, a.sentTo])).toEqual([
      ["Second", "draft", null],
      ["First", "sent", 2],
    ]);
    expect(list[1].sentAt).toEqual(new Date("2026-10-01T02:00:00Z"));
  });
});

describe("the Subscriber count", () => {
  async function customer(id: string, optIn: boolean, verified: boolean) {
    await db.sql`insert into neon_auth."user" (id, "emailVerified") values (${id}, ${verified})`;
    await db.sql`insert into customers (id, full_name, email, marketing_opt_in) values (${id}, ${id}, ${id + "@x.test"}, ${optIn})`;
  }

  it("counts verified Customers who opted in, out of every Customer", async () => {
    await customer("yes", true, true);
    await customer("no", false, true);
    await customer("lead", true, false);

    expect(await subscriberCount(db.sql)).toEqual({ subscribers: 1, customers: 2 });
  });

  it("is zero for an empty store", async () => {
    expect(await subscriberCount(db.sql)).toEqual({ subscribers: 0, customers: 0 });
  });
});

/** A photo-like image of about the given raw size: noise, so it does not compress away on its own. */
const photo = (width: number, height: number, format: "png" | "jpeg" | "webp" = "png") =>
  sharp({ create: { width, height, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 60 } } })
    [format](format === "png" ? { compressionLevel: 0 } : {})
    .toBuffer();

describe("adding an image", () => {
  it("accepts a 25 MB image and stores it much smaller, at an email-friendly width", async () => {
    const big = await photo(3300, 2400);
    expect(big.length).toBeGreaterThan(20 * 1024 * 1024);
    expect(big.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);

    const result = await addImage(ada, { filename: "halaya.png", bytes: big }, ports());

    expect(result.ok).toBe(true);
    const [kept] = [...images.stored.values()];
    expect(images.stored.size).toBe(1);
    expect(kept.bytes.length).toBeLessThan(big.length / 10);
    const meta = await sharp(kept.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(873);
  });

  it("hands back the public address Staff keep on the Announcement", async () => {
    const result = await addImage(ada, { filename: "a.jpg", bytes: await photo(400, 300, "jpeg") }, ports());

    expect(result).toEqual({ ok: true, url: "https://cdn.test/images/1.jpg" });
  });

  it("never enlarges a small image", async () => {
    await addImage(ada, { filename: "small.webp", bytes: await photo(400, 300, "webp") }, ports());

    expect((await sharp([...images.stored.values()][0].bytes).metadata()).width).toBe(400);
  });

  it("refuses a file that is not an image, and stores nothing", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 not an image");

    expect(await addImage(ada, { filename: "menu.pdf", bytes: pdf }, ports())).toEqual({ ok: false, reason: "not-an-image" });
    expect(images.stored.size).toBe(0);
  });

  it("refuses an image over 25 MB, and stores nothing", async () => {
    const tooBig = new Uint8Array(MAX_IMAGE_BYTES + 1);

    expect(await addImage(ada, { filename: "huge.png", bytes: tooBig }, ports())).toEqual({ ok: false, reason: "image-too-large" });
    expect(images.stored.size).toBe(0);
  });

  it("refuses an empty file", async () => {
    expect(await addImage(ada, { filename: "empty.png", bytes: new Uint8Array() }, ports())).toEqual({
      ok: false,
      reason: "empty-image",
    });
  });

  it("says file storage is unavailable rather than losing the image silently", async () => {
    images.down = true;

    expect(await addImage(ada, { filename: "a.jpg", bytes: await photo(400, 300, "jpeg") }, ports())).toEqual({
      ok: false,
      reason: "storage-unavailable",
    });
  });
});

describe("images on a Draft", () => {
  const a = "https://cdn.test/images/1.jpg";
  const b = "https://cdn.test/images/2.jpg";

  it("saves several images, in order, with the Draft", async () => {
    await saveDraft(db.sql, ada, { ...draft, images: [a, b] }, ports());

    expect((await listAnnouncements(db.sql))[0].images).toEqual([a, b]);
  });

  it("removes an image by editing the Draft without it", async () => {
    const saved = await saveDraft(db.sql, ada, { ...draft, images: [a, b] }, ports());
    const id = saved.ok ? saved.announcement.id : "";

    await editDraft(db.sql, ben, id, { ...draft, images: [b] }, ports());

    expect((await getAnnouncement(db.sql, id))!.images).toEqual([b]);
  });

  it("still saves a text-only Draft", async () => {
    await saveDraft(db.sql, ada, draft, ports());

    expect((await listAnnouncements(db.sql))[0].images).toEqual([]);
  });

  it("refuses an image address that is not a public HTTPS address", async () => {
    expect(await saveDraft(db.sql, ada, { ...draft, images: ["javascript:alert(1)"] }, ports())).toEqual({
      ok: false,
      reason: "invalid-image",
    });
    expect(await saveDraft(db.sql, ada, { ...draft, images: ["http://cdn.test/a.jpg"] }, ports())).toEqual({
      ok: false,
      reason: "invalid-image",
    });
  });
});
