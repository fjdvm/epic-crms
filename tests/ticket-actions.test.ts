import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimTicket,
  markResolved,
  releaseTicket,
  replyToTicket,
  type Actor,
} from "@/features/tickets/ticket-actions";

import { FakeFileStorage, JPEG, PDF, PNG } from "./fake-file-storage";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;

const bernice: Actor = { id: "bernice", name: "Bernice" };
const carlo: Actor = { id: "carlo", name: "Carlo" };

beforeAll(async () => {
  db = await startTestDatabase();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.sql`truncate ticket_messages, tickets, order_lines, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, first_name, email)
    values ('c1', 'Maria Santos', 'Maria', 'maria@example.com')`;
});

async function ticket(options: { status?: string; claimedBy?: Actor } = {}) {
  const [row] = await db.sql<{ id: number }[]>`
    insert into tickets (customer_id, subject, status, claimed_by_id, claimed_by_name)
    values ('c1', 'Halaya pouch arrived leaking', ${options.status ?? "open"},
      ${options.claimedBy?.id ?? null}, ${options.claimedBy?.name ?? null})
    returning id`;

  return row.id;
}

const claimer = async (id: number) =>
  (
    await db.sql<{ claimed_by_id: string | null; claimed_by_name: string | null }[]>`
    select claimed_by_id, claimed_by_name from tickets where id = ${id}`
  )[0];

const messages = (id: number) =>
  db.sql<
    { sender: string; body: string }[]
  >`select sender, body from ticket_messages where ticket_id = ${id} order by id`;

describe("Claim and Release", () => {
  it("Claiming an Unclaimed Ticket sets the Claimer", async () => {
    const id = await ticket();

    expect(await claimTicket(db.sql, id, bernice)).toEqual({ ok: true });
    expect(await claimer(id)).toEqual({
      claimed_by_id: "bernice",
      claimed_by_name: "Bernice",
    });
  });

  it("a second Staff member cannot Claim a Claimed Ticket, and the Claimer is unchanged", async () => {
    const id = await ticket({ claimedBy: bernice });

    expect(await claimTicket(db.sql, id, carlo)).toEqual({
      ok: false,
      reason: "claimed",
    });
    expect((await claimer(id)).claimed_by_id).toBe("bernice");
  });

  it("only the Claimer can release", async () => {
    const id = await ticket({ claimedBy: bernice });

    expect(await releaseTicket(db.sql, id, carlo)).toEqual({
      ok: false,
      reason: "not-claimer",
    });
    expect((await claimer(id)).claimed_by_id).toBe("bernice");

    expect(await releaseTicket(db.sql, id, bernice)).toEqual({ ok: true });
    expect(await claimer(id)).toEqual({
      claimed_by_id: null,
      claimed_by_name: null,
    });
  });

  it("a released Ticket can be Claimed by someone else", async () => {
    const id = await ticket({ claimedBy: bernice });
    await releaseTicket(db.sql, id, bernice);

    expect(await claimTicket(db.sql, id, carlo)).toEqual({ ok: true });
  });

  it("an unknown Ticket is not found", async () => {
    expect(await claimTicket(db.sql, 999, bernice)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("a Completed Ticket cannot be Claimed", async () => {
    const id = await ticket({ status: "completed" });

    expect(await claimTicket(db.sql, id, bernice)).toEqual({
      ok: false,
      reason: "completed",
    });
  });
});

describe("replying", () => {
  it("replying to an Unclaimed Ticket Claims it for the replier and saves the Message", async () => {
    const id = await ticket();

    expect(await replyToTicket(db.sql, id, bernice, "  So sorry about that!  ")).toMatchObject({ ok: true });
    expect((await claimer(id)).claimed_by_id).toBe("bernice");
    expect(await messages(id)).toEqual([{ sender: "staff", body: "So sorry about that!" }]);
  });

  it("the Claimer can keep replying", async () => {
    const id = await ticket({ claimedBy: bernice });

    await replyToTicket(db.sql, id, bernice, "One");
    await replyToTicket(db.sql, id, bernice, "Two");

    expect((await messages(id)).map((m) => m.body)).toEqual(["One", "Two"]);
  });

  it("another Staff member cannot reply to a Claimed Ticket, so nothing is saved or taken", async () => {
    const id = await ticket({ claimedBy: bernice });

    expect(await replyToTicket(db.sql, id, carlo, "Hello")).toEqual({
      ok: false,
      reason: "claimed",
    });
    expect(await messages(id)).toEqual([]);
    expect((await claimer(id)).claimed_by_id).toBe("bernice");
  });

  it("a blank reply is refused and does not Claim", async () => {
    const id = await ticket();

    expect(await replyToTicket(db.sql, id, bernice, "   ")).toEqual({
      ok: false,
      reason: "empty-message",
    });
    expect((await claimer(id)).claimed_by_id).toBeNull();
  });

  it("a Completed Ticket takes no reply", async () => {
    const id = await ticket({ status: "completed" });

    expect(await replyToTicket(db.sql, id, bernice, "Hello")).toEqual({
      ok: false,
      reason: "completed",
    });
    expect(await messages(id)).toEqual([]);
  });
});

describe("Mark resolved", () => {
  const url = (id: number) => `https://shop.example/support/${id}`;

  it("sets Resolved, records the time and emails the Customer once", async () => {
    const id = await ticket({ claimedBy: bernice });
    const send = vi.fn().mockResolvedValue(undefined);

    expect(await markResolved(db.sql, db.sql, id, url, send)).toEqual({
      ok: true,
      emailed: true,
    });

    const [t] = await db.sql<{ status: string; resolved_at: Date | null }[]>`
      select status, resolved_at from tickets where id = ${id}`;
    expect(t.status).toBe("resolved");
    expect(t.resolved_at).toBeInstanceOf(Date);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      to: "maria@example.com",
      button: { link: `https://shop.example/support/${id}` },
    });

    expect(await markResolved(db.sql, db.sql, id, url, send)).toEqual({
      ok: false,
      reason: "already-resolved",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a Completed Ticket stays Completed", async () => {
    const id = await ticket({ status: "completed" });
    const send = vi.fn();

    expect(await markResolved(db.sql, db.sql, id, url, send)).toEqual({
      ok: false,
      reason: "completed",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("stays Resolved and says the email failed when it cannot be sent", async () => {
    const id = await ticket();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await markResolved(db.sql, db.sql, id, url, vi.fn().mockRejectedValue(new Error("down")));

    expect(result).toEqual({ ok: true, emailed: false });
    expect((await db.sql<{ status: string }[]>`select status from tickets where id = ${id}`)[0].status).toBe(
      "resolved",
    );
  });
});

describe("image attachments", () => {
  const storage = new FakeFileStorage();

  beforeEach(() => {
    storage.reset();
  });

  const attach = (bytes: Uint8Array, filename = "pouch.jpg") => ({ image: { filename, bytes }, storage });
  const saved = (id: number) =>
    db.sql<{ body: string; file_id: string | null }[]>`
      select body, file_id from ticket_messages where ticket_id = ${id} order by id`;

  it("a reply carries one JPG, stored as a Private File Linked to the Message", async () => {
    const id = await ticket();

    const result = await replyToTicket(db.sql, id, bernice, "Here is the replacement", attach(JPEG));

    expect(result).toMatchObject({ ok: true });
    const [message] = await saved(id);
    expect(message.file_id).toBe("file-1");
    expect(storage.files.get("file-1")).toMatchObject({ contentType: "image/jpeg", filename: "pouch.jpg", link: (result as { messageId: number }).messageId });
  });

  it("a PNG is accepted, and an image alone is a Message", async () => {
    const id = await ticket();

    expect(await replyToTicket(db.sql, id, bernice, "  ", attach(PNG, "box.png"))).toMatchObject({ ok: true });
    expect(await saved(id)).toEqual([{ body: "", file_id: "file-1" }]);
    expect(storage.files.get("file-1")?.contentType).toBe("image/png");
  });

  it.each([
    ["another file type, even renamed .jpg", PDF, "invalid-image-type"],
    ["an empty file", new Uint8Array(), "empty-image"],
    ["a file over 5 MB", new Uint8Array(5 * 1024 * 1024 + 1).fill(0xff), "image-too-large"],
  ])("refuses %s and saves nothing", async (_name, bytes, reason) => {
    const id = await ticket();

    expect(await replyToTicket(db.sql, id, bernice, "Hello", attach(bytes))).toEqual({ ok: false, reason });
    expect(await saved(id)).toEqual([]);
    expect(storage.files.size).toBe(0);
  });

  it("exactly 5 MB is accepted", async () => {
    const id = await ticket();
    const bytes = new Uint8Array(5 * 1024 * 1024).fill(0);
    bytes.set(PNG);

    expect(await replyToTicket(db.sql, id, bernice, "Big one", attach(bytes))).toMatchObject({ ok: true });
  });

  it("saves nothing when file-storage is down", async () => {
    const id = await ticket();
    storage.failUpload = true;
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await replyToTicket(db.sql, id, bernice, "Hello", attach(JPEG))).toEqual({
      ok: false,
      reason: "storage-unavailable",
    });
    expect(await saved(id)).toEqual([]);
  });

  it("removes the stored image when someone else's Claim refuses the reply", async () => {
    const id = await ticket({ claimedBy: carlo });

    expect(await replyToTicket(db.sql, id, bernice, "Hello", attach(JPEG))).toEqual({ ok: false, reason: "claimed" });
    expect(storage.files.size).toBe(0);
  });

  it("keeps the Message when only the Link fails", async () => {
    const id = await ticket();
    storage.failLink = true;
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await replyToTicket(db.sql, id, bernice, "Hello", attach(JPEG))).toMatchObject({ ok: true });
    expect((await saved(id))[0].file_id).toBe("file-1");
  });
});
