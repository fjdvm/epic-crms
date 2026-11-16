import { readFileSync } from "node:fs";
import sharp, { type Sharp } from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { fingerprintReturnPhotos, loadReturnFlags } from "@/features/returns/return-flags";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestDatabase();
  const statements = readFileSync("docs/db/crms-schema.sql", "utf8").replace(/^--.*$/gm, "").split(";").map(s => s.trim())
    .filter(s => s && !/^(create role|grant|set role|reset role|revoke)/i.test(s))
    .map(s => s.replace(/^(create schema \w+) authorization \w+/i, "$1"));
  for (const statement of statements) await db.sql.unsafe(statement);
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate customers restart identity cascade`;
  await db.sql`truncate crms.return_photo_fingerprints`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Jane', 'j@example.com'), ('c2', 'Ann', 'a@example.com')`;
  await db.sql`insert into orders (customer_id, status) values ('c1', 'delivered'), ('c2', 'delivered')`;
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
async function request(orderId: number, requestedAt = new Date(), status = "requested") {
  const [row] = await db.sql<{ id: number }[]>`insert into order_returns (order_id, reason, amount_in_centavos, requested_at, status)
    values (${orderId}, 'damaged', 100, ${requestedAt}, ${status}) returning id`;
  return row.id;
}
const flags = async (id: number) => (await loadReturnFlags(db.sql, db.sql, [id])).get(id)!;

describe("Return flag: count rule", () => {
  it("flags three Returns in 90 days and links the earlier ones; two do not flag", async () => {
    const a = await request(1, daysAgo(40));
    const b = await request(1, daysAgo(10));
    expect(await flags(b)).toEqual([]);
    const c = await request(1, new Date());
    expect(await flags(c)).toEqual([{ rule: "frequent-returns", text: expect.stringContaining("3 Returns in the last 90 days"),
      earlier: [{ id: a, number: `RMA-${a}` }, { id: b, number: `RMA-${b}` }] }]);
  });

  it("ignores Returns older than 90 days, cancelled ones and other Customers", async () => {
    await request(1, daysAgo(120));
    await request(1, daysAgo(20), "cancelled");
    await request(2, daysAgo(5));
    const id = await request(1, new Date());
    expect(await flags(id)).toEqual([]);
  });
});

async function photo(seed: number, edit?: (image: Sharp) => Sharp) {
  let state = seed;
  const next = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const shapes = Array.from({ length: 12 }, () =>
    `<circle cx="${next() * 400}" cy="${next() * 400}" r="${20 + next() * 70}" fill="rgb(${Math.floor(next() * 255)},${Math.floor(next() * 255)},${Math.floor(next() * 255)})"/>`).join("");
  const image = sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="100%" height="100%" fill="rgb(${seed % 255},120,90)"/>${shapes}</svg>`)).png();
  return (edit ? edit(image) : image).toBuffer();
}

describe("Return flag: similar photo", () => {
  const files = new Map<string, Buffer>();
  const fetchPhoto = async (fileId: string) => files.get(fileId)!;
  async function returnWithPhoto(orderId: number, fileId: string, bytes: Buffer) {
    files.set(fileId, bytes);
    const id = await request(orderId);
    await db.sql`insert into order_return_images (return_id, position, file_id) values (${id}, 1, ${fileId})`;
    await fingerprintReturnPhotos(db.sql, db.sql, fetchPhoto, [id]);
    return id;
  }

  it("flags a cropped or re-saved copy of an earlier photo, and links the earlier Return", async () => {
    const original = await photo(1);
    const first = await returnWithPhoto(1, "f1", original);
    expect(await flags(first)).toEqual([]);
    const second = await returnWithPhoto(2, "f2", await sharp(original).extract({ left: 20, top: 20, width: 340, height: 340 }).jpeg({ quality: 60 }).toBuffer());
    expect(await flags(second)).toEqual([{ rule: "similar-photo", text: expect.stringContaining("already used"), earlier: [{ id: first, number: `RMA-${first}` }] }]);
  });

  it("does not flag an unrelated photo", async () => {
    await returnWithPhoto(1, "f1", await photo(1));
    const other = await returnWithPhoto(2, "f2", await photo(9));
    expect(await flags(other)).toEqual([]);
  });

  it("keeps the fingerprint with the Return, skips unreadable photos and computes each once", async () => {
    const id = await request(1);
    await db.sql`insert into order_return_images (return_id, position, file_id) values (${id}, 1, 'bad'), (${id}, 2, 'good')`;
    files.set("good", await photo(3));
    const read: string[] = [];
    const fetcher = async (f: string) => { read.push(f); if (f === "bad") throw new Error("gone"); return files.get(f)!; };
    expect(await fingerprintReturnPhotos(db.sql, db.sql, fetcher)).toBe(1);
    expect(await fingerprintReturnPhotos(db.sql, db.sql, fetcher)).toBe(0);
    expect(read).toEqual(["bad", "good", "bad"]);
    expect((await db.sql`select position from crms.return_photo_fingerprints`).map(r => r.position)).toEqual([2]);
  });

  it("never blocks: flags are information only", async () => {
    const original = await photo(1);
    await returnWithPhoto(1, "f1", original);
    const second = await returnWithPhoto(2, "f2", original);
    expect((await flags(second)).length).toBe(1);
    const [row] = await db.sql`select status from order_returns where id = ${second}`;
    expect(row.status).toBe("requested");
  });
});
