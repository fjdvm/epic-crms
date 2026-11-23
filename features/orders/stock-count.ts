import type postgres from "postgres";

import type { ImsProduct, ImsSizeStock } from "@/lib/storefront";

/**
 * CREOMS's own stock count (crms.stock_count): what the shop can sell of each IMS Size. The IMS pushes every change to it
 * (`applyImsFigures`); no CREOMS user can edit it. Products & Stocks and the shop read it.
 */
export interface MirrorSnapshot { feed: ImsProduct[]; stock: Map<number, ImsSizeStock>; syncedAt: Date }

/** The copy as `loadStock` uses it, so `stock.ts` stays free of database code (it is bundled for the browser). */
export interface StockMirror {
  load(): Promise<MirrorSnapshot | null>;
  save(feed: ImsProduct[], stock: Map<number, ImsSizeStock>): Promise<void>;
  saveOne(item: ImsProduct, stock: ImsSizeStock | undefined): Promise<void>;
  /** The IMS no longer lists this Size. */
  deleteOne(productId: number): Promise<void>;
}

interface Row {
  ims_product_id: number; name: string; variant: string | null; image: string | null; price: string | null;
  active: boolean; quantity: number | null; reserved: number | null; available: number | null; synced_at: Date;
}

const toRow = (item: ImsProduct, held: ImsSizeStock | undefined, syncedAt: Date) => ({
  ims_product_id: item.productId, name: item.name, variant: item.variant, image: item.image, price: item.price,
  active: item.active, quantity: held?.quantity ?? null, reserved: held?.reserved ?? null, available: held?.available ?? null, synced_at: syncedAt,
});

/** A product the IMS did not answer for keeps its last quantities; only an answer replaces them. */
const upsert = (sql: postgres.Sql, rows: ReturnType<typeof toRow>[]) => sql`
  insert into crms.stock_count ${sql(rows)}
  on conflict (ims_product_id) do update set name = excluded.name, variant = excluded.variant, image = excluded.image,
    price = excluded.price, active = excluded.active,
    quantity = coalesce(excluded.quantity, crms.stock_count.quantity),
    reserved = coalesce(excluded.reserved, crms.stock_count.reserved),
    available = coalesce(excluded.available, crms.stock_count.available),
    synced_at = excluded.synced_at`;

/** A full read of the IMS: upserts every product and drops the ones the IMS no longer lists. An empty feed writes nothing. */
export async function saveMirror(sql: postgres.Sql, feed: ImsProduct[], stock: Map<number, ImsSizeStock>): Promise<void> {
  if (feed.length === 0) return;
  const now = new Date();
  await sql.begin(async (tx) => {
    await upsert(tx as unknown as postgres.Sql, feed.map((item) => toRow(item, stock.get(item.productId), now)));
    await tx`delete from crms.stock_count where ims_product_id <> all(${feed.map((item) => item.productId)})`;
  });
}

export async function saveMirrorOne(sql: postgres.Sql, item: ImsProduct, held: ImsSizeStock | undefined): Promise<void> {
  await upsert(sql, [toRow(item, held, new Date())]);
}

export async function deleteMirrorOne(sql: postgres.Sql, productId: number): Promise<void> {
  await sql`delete from crms.stock_count where ims_product_id = ${productId}`;
}

/** Null when nothing was ever read from the IMS. */
export async function loadMirror(sql: postgres.Sql): Promise<MirrorSnapshot | null> {
  const rows = await sql<Row[]>`select * from crms.stock_count order by ims_product_id`;
  if (rows.length === 0) return null;
  return {
    feed: rows.map((row) => ({
      productId: row.ims_product_id, name: row.name, variant: row.variant, image: row.image,
      price: row.price === null ? null : Number(row.price), active: row.active,
    })),
    stock: new Map(rows.map((row) => [row.ims_product_id, { sizeId: row.ims_product_id, quantity: row.quantity, reserved: row.reserved, available: row.available }])),
    syncedAt: new Date(Math.max(...rows.map((row) => row.synced_at.getTime()))),
  };
}

/** One Size's figures as the IMS pushes them on every change. */
export interface ImsStockPush {
  productId: number; name: string; variant: string | null; image: string | null; price: number | null; active: boolean;
  quantity: number | null; reserved: number | null; available: number | null;
  /** Microseconds on the IMS database clock; larger is newer. */
  version: bigint;
}

/**
 * The only writer of the stock count besides the one-time backfill: keeps the figures only when they are newer than what
 * CREOMS holds, so crossed pushes never go backwards. A figure the IMS could not count (null) keeps the last one.
 */
export async function applyImsFigures(sql: postgres.Sql, push: ImsStockPush): Promise<boolean> {
  const applied = await sql`
    insert into crms.stock_count (ims_product_id, name, variant, image, price, active, quantity, reserved, available, synced_at, version, changed_at)
    values (${push.productId}, ${push.name}, ${push.variant}, ${push.image}, ${push.price}, ${push.active},
      ${push.quantity}, ${push.reserved}, ${push.available}, now(), ${push.version.toString()}, now())
    on conflict (ims_product_id) do update set name = excluded.name, variant = excluded.variant, image = excluded.image,
      price = excluded.price, active = excluded.active,
      quantity = coalesce(excluded.quantity, crms.stock_count.quantity),
      reserved = coalesce(excluded.reserved, crms.stock_count.reserved),
      available = coalesce(excluded.available, crms.stock_count.available),
      synced_at = excluded.synced_at, version = excluded.version, changed_at = excluded.changed_at
    where crms.stock_count.version < excluded.version
    returning ims_product_id`;
  return applied.length > 0;
}
